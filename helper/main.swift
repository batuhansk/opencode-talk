// opencode-talk-helper: streams on-device macOS speech recognition as JSON lines.
//
// Usage:
//   opencode-talk-helper listen [--lang en-US] [--mic "MacBook"] [--hint JSON ...]
//   opencode-talk-helper mics
//   opencode-talk-helper transcribe <audio-file> [--hint ...]
//   opencode-talk-helper check
//
// Output (stdout, one JSON object per line):
//   {"event":"ready","mic":"MacBook Pro Microphone","onDevice":"true"}
//   {"event":"level","value":"0.42"}       (input level 0...1, ~8/s)
//   {"event":"partial","text":"..."}
//   {"event":"final","text":"..."}
//   {"event":"error","message":"..."}
//
// Write "stop" to stdin (or close it) to finish and get the final text.
// SIGINT/SIGTERM abort immediately. Exits if its parent process goes away.

import AVFoundation
import Foundation
import Speech

// MARK: - Output

func emit(_ fields: [String: String]) {
  guard let data = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]),
    let line = String(data: data, encoding: .utf8)
  else { return }
  print(line)
  fflush(stdout)
}

func fail(_ message: String) -> Never {
  emit(["event": "error", "message": message])
  exit(1)
}

// MARK: - Responsible-process relaunch

// macOS asks for microphone/speech permission on behalf of the "responsible"
// process (usually the terminal app). Re-launch ourselves as our own
// responsible process so the prompt names this helper and works from any host.

/// Read by the async-signal handler below, which can't capture context.
nonisolated(unsafe) private var relaunchedChild: pid_t = 0

func relaunchAsResponsible() {
  let childMarker = "OPENCODE_TALK_CHILD"
  guard ProcessInfo.processInfo.environment[childMarker] == nil else { return }

  typealias Disclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
  let defaultHandle = UnsafeMutableRawPointer(bitPattern: -2)  // RTLD_DEFAULT
  guard let symbol = dlsym(defaultHandle, "responsibility_spawnattrs_setdisclaim") else { return }
  let disclaim = unsafeBitCast(symbol, to: Disclaim.self)

  var attributes: posix_spawnattr_t?
  posix_spawnattr_init(&attributes)
  defer { posix_spawnattr_destroy(&attributes) }
  _ = disclaim(&attributes, 1)

  setenv(childMarker, "1", 1)
  let path = Bundle.main.executablePath ?? CommandLine.arguments[0]
  var argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
  defer { argv.forEach { free($0) } }

  var pid: pid_t = 0
  guard posix_spawn(&pid, path, nil, &attributes, &argv, environ) == 0 else { return }
  relaunchedChild = pid

  for sig in [SIGINT, SIGTERM, SIGHUP] {
    signal(sig) { received in
      kill(relaunchedChild, SIGTERM)
      _exit(128 + received)
    }
  }

  var status: Int32 = 0
  while waitpid(pid, &status, 0) == -1 && errno == EINTR {}
  let exited = (status & 0x7f) == 0
  exit(exited ? (status >> 8) & 0xff : 1)
}

// MARK: - Arguments

struct Options {
  var command = "listen"
  var language = Locale.current.identifier.components(separatedBy: "@")[0]
  var hints: [String] = []
  var mic: String?
  var positional: [String] = []

  init(_ arguments: [String]) {
    var rest = arguments[...]
    if let first = rest.first, !first.hasPrefix("--") {
      command = first
      rest = rest.dropFirst()
    }
    while let flag = rest.popFirst() {
      guard flag.hasPrefix("--") else {
        positional.append(flag)
        continue
      }
      guard let value = rest.popFirst() else { break }
      switch flag {
      case "--lang": language = value
      case "--hint": hints.append(value)
      case "--mic": mic = value
      default: break
      }
    }
  }
}

// MARK: - Microphones

func microphones() -> [AVCaptureDevice] {
  AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone], mediaType: .audio, position: .unspecified).devices
}

/// Finds a microphone by case-insensitive name fragment, e.g. "macbook".
func findMicrophone(_ query: String) -> AVCaptureDevice? {
  microphones().first { $0.localizedName.localizedCaseInsensitiveContains(query) }
}

// MARK: - Permissions

func authorize() async {
  let speech = await withCheckedContinuation { continuation in
    SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
  }
  guard speech == .authorized else {
    fail("Speech recognition not allowed. Enable it in System Settings → Privacy & Security → Speech Recognition.")
  }
  guard await AVCaptureDevice.requestAccess(for: .audio) else {
    fail("Microphone not allowed. Enable it in System Settings → Privacy & Security → Microphone.")
  }
}

// MARK: - Live listening

/// Receives microphone audio on a capture queue and feeds the recognizer.
/// `SFSpeechAudioBufferRecognitionRequest` is safe to append to from that
/// queue, but isn't annotated as Sendable.
final class AudioSink: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
  let request: SFSpeechAudioBufferRecognitionRequest
  private var lastLevel = ContinuousClock.now

  init(_ request: SFSpeechAudioBufferRecognitionRequest) { self.request = request }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    request.appendAudioSampleBuffer(sampleBuffer)

    // Report the input level (0...1) about 8 times a second so the UI can
    // show that the microphone actually hears something.
    let now = ContinuousClock.now
    guard now - lastLevel >= .milliseconds(120) else { return }
    lastLevel = now
    let decibels = connection.audioChannels.map(\.averagePowerLevel).max() ?? -160
    let level = max(0, min(1, (decibels + 60) / 60))
    emit(["event": "level", "value": String(format: "%.2f", level)])
  }
}

@MainActor
final class Listener {
  private let recognizer: SFSpeechRecognizer
  private let microphone: AVCaptureDevice
  private let session = AVCaptureSession()
  private let sink: AudioSink
  private let queue = DispatchQueue(label: "opencode-talk.audio")
  private var task: SFSpeechRecognitionTask?
  private var lastText = ""
  private var finished = false
  private var stopping = false

  init(recognizer: SFSpeechRecognizer, hints: [String], microphone: AVCaptureDevice) {
    self.recognizer = recognizer
    self.microphone = microphone
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.contextualStrings = hints
    request.addsPunctuation = true
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    sink = AudioSink(request)
  }

  func start() {
    do {
      let input = try AVCaptureDeviceInput(device: microphone)
      let output = AVCaptureAudioDataOutput()
      output.setSampleBufferDelegate(sink, queue: queue)
      session.beginConfiguration()
      guard session.canAddInput(input), session.canAddOutput(output) else {
        fail("Could not use microphone \(microphone.localizedName)")
      }
      session.addInput(input)
      session.addOutput(output)
      session.commitConfiguration()
    } catch {
      fail("Could not open microphone \(microphone.localizedName): \(error.localizedDescription)")
    }

    task = recognizer.recognitionTask(with: sink.request, resultHandler: Self.results(to: self))
    session.startRunning()
    guard session.isRunning else { fail("Could not start microphone \(microphone.localizedName)") }
    emit([
      "event": "ready",
      "mic": microphone.localizedName,
      "onDevice": String(sink.request.requiresOnDeviceRecognition),
    ])
  }

  // Recognition callbacks arrive on a background thread. Build the handler in
  // a nonisolated function so it doesn't inherit main-actor isolation (which
  // Swift 6 enforces at runtime by trapping).
  private nonisolated static func results(
    to listener: Listener
  ) -> @Sendable (SFSpeechRecognitionResult?, (any Error)?) -> Void {
    { @Sendable result, error in
      let text = result?.bestTranscription.formattedString
      let isFinal = result?.isFinal ?? false
      let failure = error.flatMap { ($0 as NSError).code == 1110 ? nil : $0.localizedDescription }
      let ended = error != nil
      Task { @MainActor in listener.handle(text: text, isFinal: isFinal, error: failure, ended: ended) }
    }
  }

  /// Stops recording, then waits briefly for the recognizer's final result.
  func stop() {
    guard !stopping else { return }
    stopping = true
    session.stopRunning()
    sink.request.endAudio()
    Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(1500))
      self.finish()
    }
  }

  private func handle(text: String?, isFinal: Bool, error: String?, ended: Bool) {
    if let text {
      lastText = text
      if isFinal { return finish() }
      emit(["event": "partial", "text": text])
    } else if ended {
      // "No speech detected" (1110) ends with whatever we have; other errors
      // while still recording are real failures.
      if let error, !stopping { fail(error) }
      finish()
    }
  }

  private func finish() {
    guard !finished else { return }
    finished = true
    task?.cancel()
    emit(["event": "final", "text": lastText])
    exit(0)
  }
}

// MARK: - Lifecycle guards

func installAbortSignals() {
  for sig in [SIGINT, SIGTERM, SIGHUP] {
    signal(sig) { received in _exit(128 + received) }
  }
}

/// Exit if the process that started us goes away, and cap session length.
@MainActor
func startWatchdog(onTimeout: @escaping @MainActor () -> Void) {
  let parent = getppid()
  let started = ContinuousClock.now
  Task { @MainActor in
    while true {
      try? await Task.sleep(for: .milliseconds(500))
      if getppid() != parent { _exit(0) }
      if ContinuousClock.now - started > .seconds(600) { onTimeout() }
    }
  }
}

/// Watches stdin for "stop" when it's a pipe or socket from the plugin.
/// (/dev/null or a TTY would otherwise stop immediately or never.)
func watchStdin(onStop: @escaping @Sendable () -> Void) {
  var info = stat()
  guard fstat(STDIN_FILENO, &info) == 0, [S_IFIFO, S_IFSOCK].contains(info.st_mode & S_IFMT) else { return }
  Thread {
    while let line = readLine() {
      if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
    }
    onStop()
  }.start()
}

// MARK: - Commands

func transcribe(file path: String, recognizer: SFSpeechRecognizer, hints: [String]) async -> Never {
  let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
  request.contextualStrings = hints
  request.addsPunctuation = true
  if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }

  recognizer.recognitionTask(with: request, resultHandler: fileResults())
  await runForever()
}

private func fileResults() -> @Sendable (SFSpeechRecognitionResult?, (any Error)?) -> Void {
  { @Sendable result, error in
    if let result, result.isFinal {
      emit(["event": "final", "text": result.bestTranscription.formattedString])
      exit(0)
    } else if let error {
      fail(error.localizedDescription)
    }
  }
}

/// Keeps the process alive; every command ends by calling exit().
func runForever() async -> Never {
  while true { try? await Task.sleep(for: .seconds(3600)) }
}

// MARK: - Main

relaunchAsResponsible()

let options = Options(Array(CommandLine.arguments.dropFirst()))
guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: options.language)) else {
  fail("No speech recognizer for language \(options.language)")
}

switch options.command {
case "check":
  await authorize()
  emit([
    "event": "ok",
    "lang": options.language,
    "onDevice": String(recognizer.supportsOnDeviceRecognition),
  ])
  exit(0)

case "mics":
  let current = AVCaptureDevice.default(for: .audio)?.uniqueID
  for mic in microphones() {
    emit(["event": "mic", "name": mic.localizedName, "default": String(mic.uniqueID == current)])
  }
  exit(0)

case "transcribe":
  guard let path = options.positional.first else { fail("Usage: transcribe <audio-file>") }
  await authorize()
  await transcribe(file: path, recognizer: recognizer, hints: options.hints)

case "listen":
  await authorize()
  guard recognizer.isAvailable else { fail("Speech recognizer is not available right now") }
  installAbortSignals()
  let microphone: AVCaptureDevice
  if let query = options.mic {
    guard let found = findMicrophone(query) else {
      fail("No microphone matching \"\(query)\". Available: \(microphones().map(\.localizedName).joined(separator: ", "))")
    }
    microphone = found
  } else {
    guard let found = AVCaptureDevice.default(for: .audio) else {
      fail("No microphone found. Check System Settings → Sound → Input.")
    }
    microphone = found
  }
  let listener = Listener(recognizer: recognizer, hints: options.hints, microphone: microphone)
  listener.start()
  startWatchdog { listener.stop() }
  watchStdin { Task { @MainActor in listener.stop() } }
  await runForever()

default:
  fail("Unknown command: \(options.command)")
}
