// opencode-talk-helper: streams on-device macOS speech recognition as JSON lines.
//
// Usage:
//   opencode-talk-helper listen [--lang en-US] [--mic "MacBook"] [--engine auto|dictation|legacy] [--hint JSON ...]
//   opencode-talk-helper prepare [--lang en-US --lang tr-TR]   (installs macOS 26 dictation models)
//   opencode-talk-helper languages [--lang ...] [--all]         (default: System Settings languages)
//   Add --allow-cloud to permit Apple's servers for languages without on-device support.
//   opencode-talk-helper mics
//   opencode-talk-helper transcribe <audio-file> [--engine ...] [--hint ...]
//   opencode-talk-helper check
//
// Output (stdout, one JSON object per line):
//   {"event":"ready","mic":"MacBook Pro Microphone","engine":"dictation"}
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

/// Set OPENCODE_TALK_DEBUG=1 to log diagnostics to stderr.
let debugEnabled = ProcessInfo.processInfo.environment["OPENCODE_TALK_DEBUG"] != nil

func debug(_ message: @autoclosure () -> String) {
  guard debugEnabled else { return }
  FileHandle.standardError.write(Data("[opencode-talk] \(message())\n".utf8))
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
  var engine = "auto"
  var allowCloud = false
  var all = false
  var languages: [String] = []
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
      if flag == "--allow-cloud" {
        allowCloud = true
        continue
      }
      if flag == "--all" {
        all = true
        continue
      }
      guard let value = rest.popFirst() else { break }
      switch flag {
      case "--lang":
        language = value
        languages.append(value)
      case "--hint": hints.append(value)
      case "--mic": mic = value
      case "--engine": engine = value
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

// MARK: - Engines

/// The speech engine behind a listening session.
///
/// - `dictation`: macOS 26 `SpeechAnalyzer` + `DictationTranscriber`, Apple's
///   newer on-device model built for dictation. Needs its language assets
///   installed (done once by the system; see the `prepare` command).
/// - `legacy`: `SFSpeechRecognizer`, available on macOS 14+.
enum EngineKind: String {
  case dictation, legacy
}

/// The current best text from either engine.
struct Transcript {
  var finalized = ""
  var text: String { finalized.trimmingCharacters(in: .whitespaces) }
}

/// Receives microphone audio on a capture queue and hands it to the engine.
/// Also reports the input level so the UI can show the mic hears something.
final class AudioSink: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
  private let feed: @Sendable (CMSampleBuffer) -> Void
  private var lastLevel = ContinuousClock.now

  init(feed: @escaping @Sendable (CMSampleBuffer) -> Void) { self.feed = feed }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    feed(sampleBuffer)

    let now = ContinuousClock.now
    guard now - lastLevel >= .milliseconds(120) else { return }
    lastLevel = now
    let decibels = connection.audioChannels.map(\.averagePowerLevel).max() ?? -160
    let level = max(0, min(1, (decibels + 60) / 60))
    emit(["event": "level", "value": String(format: "%.2f", level)])
  }
}

// MARK: - Legacy engine (SFSpeechRecognizer, macOS 14+)

/// `SFSpeechAudioBufferRecognitionRequest` is safe to append to from the
/// capture queue, but isn't annotated as Sendable.
final class LegacyEngine: @unchecked Sendable {
  let request = SFSpeechAudioBufferRecognitionRequest()
  private let recognizer: SFSpeechRecognizer
  private var task: SFSpeechRecognitionTask?

  init(recognizer: SFSpeechRecognizer, hints: [String]) {
    self.recognizer = recognizer
    request.shouldReportPartialResults = true
    request.contextualStrings = hints
    request.addsPunctuation = true
    // Only reached without on-device support when the user allowed cloud recognition.
    request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
  }

  func feed(_ buffer: CMSampleBuffer) { request.appendAudioSampleBuffer(buffer) }

  @MainActor
  func start(listener: Listener) {
    task = recognizer.recognitionTask(with: request, resultHandler: Self.results(to: listener))
  }

  func finish() { request.endAudio() }
  func cancel() { task?.cancel() }

  // Callbacks arrive on a background thread. Build the handler in a
  // nonisolated function so it doesn't inherit main-actor isolation (which
  // Swift 6 enforces at runtime by trapping).
  private static func results(to listener: Listener) -> @Sendable (SFSpeechRecognitionResult?, (any Error)?) -> Void {
    { @Sendable result, error in
      let text = result?.bestTranscription.formattedString
      let isFinal = result?.isFinal ?? false
      let failure = error.flatMap { ($0 as NSError).code == 1110 ? nil : $0.localizedDescription }
      let ended = error != nil
      Task { @MainActor in
        if let text {
          listener.update(Transcript(finalized: text), isFinal: isFinal)
        } else if ended {
          // "No speech detected" (1110) just ends with whatever we have.
          listener.ended(error: failure)
        }
      }
    }
  }
}

// MARK: - Dictation engine (SpeechAnalyzer, macOS 26+)

@available(macOS 26.0, *)
enum DictationAssets {
  static func supportedLocale(for language: String) async -> Locale? {
    await DictationTranscriber.supportedLocale(equivalentTo: Locale(identifier: language))
  }

  static func isInstalled(_ locale: Locale) async -> Bool {
    await DictationTranscriber.installedLocales.contains { $0.identifier(.bcp47) == locale.identifier(.bcp47) }
  }

  /// Asks the system to download the on-device model if needed. Returns
  /// whether the model is ready afterwards.
  static func install(_ locale: Locale) async -> Bool {
    let module = DictationTranscriber(locale: locale, preset: .progressiveShortDictation)
    do {
      if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
        try await request.downloadAndInstall()
      }
      return true
    } catch {
      return false
    }
  }
}

/// Stitches analyzer results into one transcript. Each result covers a time
/// range and supersedes any earlier text from its start onward (volatile
/// results get revised; `isFinal` alone isn't reliable for dictation).
@available(macOS 26.0, *)
struct SegmentedTranscript {
  private var segments: [(start: CMTime, text: String)] = []

  mutating func apply(_ result: DictationTranscriber.Result) {
    let start = result.range.start
    segments.removeAll { CMTimeCompare($0.start, start) >= 0 }
    segments.append((start, String(result.text.characters)))
  }

  var text: String {
    segments.map { $0.text.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
  }
}

/// Converts captured audio to the analyzer's format and streams it in.
@available(macOS 26.0, *)
final class DictationEngine: @unchecked Sendable {
  private let locale: Locale
  private let hints: [String]
  private let transcriber: DictationTranscriber
  private let analyzer: SpeechAnalyzer
  private let input: AsyncStream<AnalyzerInput>
  private let continuation: AsyncStream<AnalyzerInput>.Continuation
  private var targetFormat: AVAudioFormat?
  private var converter: AVAudioConverter?  // only touched on the capture queue
  private var resultsTask: Task<Void, Never>?

  init(locale: Locale, hints: [String]) {
    self.locale = locale
    self.hints = hints
    transcriber = DictationTranscriber(locale: locale, preset: .progressiveShortDictation)
    analyzer = SpeechAnalyzer(modules: [transcriber])
    (input, continuation) = AsyncStream<AnalyzerInput>.makeStream()
  }

  @MainActor
  func start(listener: Listener) async throws {
    targetFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
    debug("analyzer format: \(targetFormat.map { "\($0)" } ?? "none")")
    if !hints.isEmpty {
      let context = AnalysisContext()
      context.contextualStrings[.general] = hints
      try await analyzer.setContext(context)
    }
    try await analyzer.start(inputSequence: input)

    let results = transcriber.results
    resultsTask = Task { @MainActor in
      var transcript = SegmentedTranscript()
      do {
        for try await result in results {
          debug("result: \(String(result.text.characters))")
          transcript.apply(result)
          listener.update(Transcript(finalized: transcript.text), isFinal: false)
        }
        listener.ended(error: nil)
      } catch {
        listener.ended(error: error.localizedDescription)
      }
    }
  }

  func feed(_ sampleBuffer: CMSampleBuffer) {
    guard let buffer = Self.pcmBuffer(from: sampleBuffer) else { return debug("could not read sample buffer") }
    feed(buffer)
  }

  func feed(_ buffer: AVAudioPCMBuffer) {
    guard let target = targetFormat else { return debug("no analyzer format yet") }
    if buffer.format == target {
      continuation.yield(AnalyzerInput(buffer: buffer))
      return
    }
    if converter == nil || converter?.inputFormat != buffer.format {
      converter = AVAudioConverter(from: buffer.format, to: target)
      debug("converting \(buffer.format) -> \(target): \(converter == nil ? "failed" : "ok")")
    }
    guard let converter else { return }
    let ratio = target.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 1
    guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
    // The converter calls this block synchronously on this queue.
    nonisolated(unsafe) let source = buffer
    nonisolated(unsafe) var consumed = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return source
    }
    if let error { debug("convert error: \(error)") }
    if error == nil, output.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: output)) }
  }

  /// Ends the input; the results loop then delivers the last text and ends.
  func finish() async {
    continuation.finish()
    try? await analyzer.finalizeAndFinishThroughEndOfInput()
  }

  func cancel() {
    continuation.finish()
    resultsTask?.cancel()
  }

  private static func pcmBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
    guard let description = sampleBuffer.formatDescription,
      var streamDescription = description.audioStreamBasicDescription,
      let format = AVAudioFormat(streamDescription: &streamDescription)
    else { return nil }
    let frames = AVAudioFrameCount(sampleBuffer.numSamples)
    guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
    buffer.frameLength = frames
    let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
      sampleBuffer, at: 0, frameCount: Int32(frames), into: buffer.mutableAudioBufferList)
    return status == noErr ? buffer : nil
  }
}

// MARK: - Live listening

@MainActor
final class Listener {
  private enum Engine {
    case legacy(LegacyEngine)
    case dictation(any Sendable)  // DictationEngine on macOS 26+
  }

  private let microphone: AVCaptureDevice
  /// Test-only: stream this audio file in real time instead of the mic.
  var testFile: String?
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "opencode-talk.audio")
  private let engine: Engine
  private var sink: AudioSink?
  private var lastText = ""
  private var finished = false
  private var stopping = false

  init(legacy: LegacyEngine, microphone: AVCaptureDevice) {
    self.microphone = microphone
    engine = .legacy(legacy)
  }

  @available(macOS 26.0, *)
  init(dictation: DictationEngine, microphone: AVCaptureDevice) {
    self.microphone = microphone
    engine = .dictation(dictation)
  }

  var engineName: EngineKind {
    if case .dictation = engine { return .dictation }
    return .legacy
  }

  func start() async {
    let feed: @Sendable (CMSampleBuffer) -> Void
    switch engine {
    case .legacy(let legacy):
      legacy.start(listener: self)
      feed = { legacy.feed($0) }
    case .dictation(let boxed):
      guard #available(macOS 26.0, *), let dictation = boxed as? DictationEngine else { fail("Engine unavailable") }
      do {
        try await dictation.start(listener: self)
      } catch {
        fail("Could not start dictation: \(error.localizedDescription)")
      }
      feed = { dictation.feed($0) }
    }

    if let testFile {
      streamTestFile(testFile)
      return
    }

    let sink = AudioSink(feed: feed)
    self.sink = sink
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
    session.startRunning()
    guard session.isRunning else { fail("Could not start microphone \(microphone.localizedName)") }
    emit(["event": "ready", "mic": microphone.localizedName, "engine": engineName.rawValue, "lang": options.language])
  }

  /// Plays an audio file through the same pipeline as the microphone, in real
  /// time, then stops. Used by the integration tests.
  private func streamTestFile(_ path: String) {
    guard let file = try? AVAudioFile(forReading: URL(fileURLWithPath: path)) else { fail("Cannot read \(path)") }
    emit(["event": "ready", "mic": "file", "engine": engineName.rawValue, "lang": options.language])
    let pcmFeed: (@Sendable (AVAudioPCMBuffer) -> Void)?
    switch engine {
    case .legacy(let legacy): pcmFeed = { legacy.request.append($0) }
    case .dictation(let boxed):
      if #available(macOS 26.0, *), let dictation = boxed as? DictationEngine { pcmFeed = { dictation.feed($0) } } else { pcmFeed = nil }
    }
    let format = file.processingFormat
    let chunk = AVAudioFrameCount(format.sampleRate / 10)  // 100 ms
    let source = file
    Task.detached {
      while let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunk),
        (try? source.read(into: buffer, frameCount: chunk)) != nil, buffer.frameLength > 0
      {
        pcmFeed?(buffer)
        try? await Task.sleep(for: .milliseconds(100))
      }
      try? await Task.sleep(for: .milliseconds(500))
      await MainActor.run { self.stop() }
    }
  }

  /// Stops recording and lets the engine deliver its final text.
  func stop() {
    guard !stopping else { return }
    stopping = true
    session.stopRunning()
    switch engine {
    case .legacy(let legacy):
      legacy.finish()
      // The legacy recognizer may not report "final" promptly; cap the wait.
      Task { @MainActor in
        try? await Task.sleep(for: .milliseconds(1500))
        self.finish()
      }
    case .dictation(let boxed):
      guard #available(macOS 26.0, *), let dictation = boxed as? DictationEngine else { return finish() }
      Task { @MainActor in
        await dictation.finish()
        try? await Task.sleep(for: .milliseconds(300))
        self.finish()
      }
    }
  }

  func update(_ transcript: Transcript, isFinal: Bool) {
    guard !finished else { return }
    let text = transcript.text
    if !text.isEmpty, text != lastText {
      lastText = text
      emit(["event": "partial", "text": text])
    }
    if isFinal { finish() }
  }

  func ended(error: String?) {
    // Errors while still recording are real failures; after stop they're noise.
    if let error, !stopping { fail(error) }
    finish()
  }

  private func finish() {
    guard !finished else { return }
    finished = true
    switch engine {
    case .legacy(let legacy): legacy.cancel()
    case .dictation(let boxed):
      if #available(macOS 26.0, *), let dictation = boxed as? DictationEngine { dictation.cancel() }
    }
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

// MARK: - Engine selection

/// Display name like "Turkish (Türkiye)".
func displayName(_ identifier: String) -> String {
  Locale(identifier: "en").localizedString(forIdentifier: identifier) ?? identifier
}

/// Whether the legacy recognizer can run this language on-device.
func legacyOnDevice(_ language: String) -> Bool {
  SFSpeechRecognizer(locale: Locale(identifier: language))?.supportsOnDeviceRecognition ?? false
}

/// Picks the engine for a language:
/// 1. the macOS 26 dictation engine when its model is installed (always on-device);
/// 2. otherwise the legacy engine if it runs on-device;
/// 3. otherwise install the dictation model now (a one-time system download);
/// 4. otherwise the legacy engine via Apple's servers, only if the user allowed it.
func chooseEngine(_ requested: String, language: String, allowCloud: Bool) async -> (EngineKind, Locale?) {
  let name = displayName(language)
  let onDevice = legacyOnDevice(language)
  let cloudHint = "Set \"onDeviceOnly\": false to allow Apple's servers for it."

  if requested == "legacy" {
    guard onDevice || allowCloud else { fail("\(name) isn't available on-device with the legacy engine. \(cloudHint)") }
    return (.legacy, nil)
  }

  if #available(macOS 26.0, *), let locale = await DictationAssets.supportedLocale(for: language) {
    if await DictationAssets.isInstalled(locale) { return (.dictation, locale) }
    if requested == "dictation" || !onDevice {
      emit(["event": "installing", "lang": language, "name": name])
      guard await DictationAssets.install(locale) else {
        if onDevice || allowCloud { return (.legacy, nil) }
        fail("Couldn't download Apple's on-device model for \(name). Check your connection and try again.")
      }
      return (.dictation, locale)
    }
  } else if requested == "dictation" {
    fail("The dictation engine needs macOS 26 and a language it supports.")
  }

  guard onDevice || allowCloud else { fail("\(name) can't be recognized on-device on this Mac. \(cloudHint)") }
  return (.legacy, nil)
}

/// Describes a language: whether it's supported, on-device, and by which engine.
func describe(_ language: String) async -> [String: String] {
  var info = ["event": "language", "lang": language, "name": displayName(language)]
  var supported = SFSpeechRecognizer(locale: Locale(identifier: language)) != nil
  var onDevice = legacyOnDevice(language)
  var engine = onDevice ? "legacy" : "cloud"
  if #available(macOS 26.0, *), let locale = await DictationAssets.supportedLocale(for: language) {
    supported = true
    onDevice = true
    engine = "dictation"
    info["installed"] = String(await DictationAssets.isInstalled(locale))
  }
  info["supported"] = String(supported)
  info["onDevice"] = String(onDevice)
  info["engine"] = supported ? engine : "none"
  return info
}

// MARK: - Commands

func transcribeLegacy(file path: String, recognizer: SFSpeechRecognizer, hints: [String]) async -> Never {
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
      emit(["event": "final", "text": result.bestTranscription.formattedString, "engine": "legacy"])
      exit(0)
    } else if let error {
      fail(error.localizedDescription)
    }
  }
}

@available(macOS 26.0, *)
func transcribeDictation(file path: String, locale: Locale, hints: [String]) async -> Never {
  do {
    let transcriber = DictationTranscriber(locale: locale, preset: .shortDictation)
    let context = AnalysisContext()
    context.contextualStrings[.general] = hints
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
    let analyzer = try await SpeechAnalyzer(
      inputAudioFile: file, modules: [transcriber], analysisContext: context, finishAfterFile: true)
    var transcript = SegmentedTranscript()
    for try await result in transcriber.results { transcript.apply(result) }
    withExtendedLifetime(analyzer) {}  // keep the analyzer alive while reading results
    emit(["event": "final", "text": transcript.text, "engine": "dictation"])
    exit(0)
  } catch {
    fail(error.localizedDescription)
  }
}

/// Keeps the process alive; every command ends by calling exit().
func runForever() async -> Never {
  while true { try? await Task.sleep(for: .seconds(3600)) }
}

// MARK: - Main

relaunchAsResponsible()

let options = Options(Array(CommandLine.arguments.dropFirst()))

/// The legacy recognizer for the requested language (needed by check, transcribe, listen).
func legacyRecognizer() -> SFSpeechRecognizer {
  guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: options.language)) else {
    fail("\(displayName(options.language)) isn't supported for speech recognition on this Mac.")
  }
  return recognizer
}

switch options.command {
case "check":
  let recognizer = legacyRecognizer()
  await authorize()
  let (engine, _) = await chooseEngine("auto", language: options.language, allowCloud: true)
  emit([
    "event": "ok",
    "lang": options.language,
    "engine": engine.rawValue,
    "onDevice": String(engine == .dictation || recognizer.supportsOnDeviceRecognition),
  ])
  exit(0)

case "languages":
  // --all: every language this Mac can recognize. Otherwise the given --lang
  // values, or the user's preferred languages from System Settings.
  var requested = options.languages.isEmpty ? Locale.preferredLanguages : options.languages
  if options.all {
    var ids = SFSpeechRecognizer.supportedLocales().map { $0.identifier(.bcp47) }
    if #available(macOS 26.0, *) {
      ids += await DictationTranscriber.supportedLocales.map { $0.identifier(.bcp47) }
    }
    requested = Array(Set(ids)).sorted { displayName($0) < displayName($1) }
  }
  var seen = Set<String>()
  for language in requested where seen.insert(language).inserted {
    emit(await describe(language))
  }
  exit(0)

case "prepare":
  // Installs the macOS 26 dictation model for each language if needed
  // (a one-time, system-managed download).
  for language in options.languages.isEmpty ? [options.language] : options.languages {
    guard #available(macOS 26.0, *), let locale = await DictationAssets.supportedLocale(for: language) else {
      emit(["event": "ok", "lang": language, "engine": legacyOnDevice(language) ? "legacy" : "cloud"])
      continue
    }
    let ready = await DictationAssets.isInstalled(locale) ? true : await DictationAssets.install(locale)
    emit(["event": "ok", "lang": language, "engine": ready ? "dictation" : "legacy"])
  }
  exit(0)

case "mics":
  let current = AVCaptureDevice.default(for: .audio)?.uniqueID
  for mic in microphones() {
    emit(["event": "mic", "name": mic.localizedName, "default": String(mic.uniqueID == current)])
  }
  exit(0)

case "transcribe":
  guard let path = options.positional.first else { fail("Usage: transcribe <audio-file>") }
  let recognizer = legacyRecognizer()
  await authorize()
  let (engine, locale) = await chooseEngine(options.engine, language: options.language, allowCloud: options.allowCloud)
  if engine == .dictation, #available(macOS 26.0, *), let locale {
    await transcribeDictation(file: path, locale: locale, hints: options.hints)
  }
  await transcribeLegacy(file: path, recognizer: recognizer, hints: options.hints)

case "listen":
  let recognizer = legacyRecognizer()
  await authorize()
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

  let (engine, locale) = await chooseEngine(options.engine, language: options.language, allowCloud: options.allowCloud)
  let listener: Listener
  if engine == .dictation, #available(macOS 26.0, *), let locale {
    listener = Listener(dictation: DictationEngine(locale: locale, hints: options.hints), microphone: microphone)
  } else {
    guard recognizer.isAvailable else { fail("Speech recognizer is not available right now") }
    listener = Listener(legacy: LegacyEngine(recognizer: recognizer, hints: options.hints), microphone: microphone)
  }
  listener.testFile = ProcessInfo.processInfo.environment["OPENCODE_TALK_TEST_FILE"]
  await listener.start()
  startWatchdog { listener.stop() }
  watchStdin { Task { @MainActor in listener.stop() } }
  await runForever()

default:
  fail("Unknown command: \(options.command)")
}
