// opencode-talk-helper: streams on-device macOS speech recognition as JSON lines.
//
// Usage:
//   opencode-talk-helper listen [--lang en-US] [--hint JSON --hint kubectl ...]
//   opencode-talk-helper transcribe <audio-file> [--hint ...]
//   opencode-talk-helper check
//
// Output (stdout, one JSON object per line):
//   {"event":"ready"}
//   {"event":"partial","text":"..."}
//   {"event":"final","text":"..."}
//   {"event":"error","message":"..."}
//
// Stops when stdin receives "stop", stdin closes, or on SIGINT/SIGTERM.

import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

// macOS asks for microphone/speech permission on behalf of the "responsible"
// process (usually the terminal app). Re-launch ourselves as our own
// responsible process so the prompt names this helper and works from any host.
func relaunchAsResponsible() {
  if ProcessInfo.processInfo.environment["OPENCODE_TALK_CHILD"] != nil { return }
  typealias Disclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
  guard let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim")
  else { return }
  let disclaim = unsafeBitCast(sym, to: Disclaim.self)
  var attr: posix_spawnattr_t?
  posix_spawnattr_init(&attr)
  _ = disclaim(&attr, 1)
  setenv("OPENCODE_TALK_CHILD", "1", 1)
  let path = Bundle.main.executablePath ?? CommandLine.arguments[0]
  var argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
  var pid: pid_t = 0
  guard posix_spawn(&pid, path, nil, &attr, &argv, environ) == 0 else { return }
  // Forward stop signals to the child; it handles them gracefully.
  for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: .global())
    src.setEventHandler { kill(pid, sig) }
    src.resume()
    _ = Unmanaged.passRetained(src)
  }
  var status: Int32 = 0
  while waitpid(pid, &status, 0) == -1 && errno == EINTR {}
  exit((status >> 8) & 0xff)
}
relaunchAsResponsible()

func emit(_ obj: [String: String]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj),
    let line = String(data: data, encoding: .utf8)
  else { return }
  print(line)
}

func fail(_ message: String) -> Never {
  emit(["event": "error", "message": message])
  exit(1)
}

var args = Array(CommandLine.arguments.dropFirst())
let command = args.isEmpty ? "listen" : args.removeFirst()
var lang = Locale.current.identifier.components(separatedBy: "@")[0]
var hints: [String] = []
var positional: [String] = []
while !args.isEmpty {
  let flag = args.removeFirst()
  if !flag.hasPrefix("--") { positional.append(flag); continue }
  guard !args.isEmpty else { break }
  let value = args.removeFirst()
  if flag == "--lang" { lang = value } else if flag == "--hint" { hints.append(value) }
}

func authorize() {
  let sem = DispatchSemaphore(value: 0)
  var speechOK = false
  SFSpeechRecognizer.requestAuthorization { status in
    speechOK = status == .authorized
    sem.signal()
  }
  sem.wait()
  guard speechOK else {
    fail("Speech recognition not allowed. Enable it in System Settings → Privacy & Security → Speech Recognition.")
  }
  var micOK = false
  AVCaptureDevice.requestAccess(for: .audio) { ok in
    micOK = ok
    sem.signal()
  }
  sem.wait()
  guard micOK else {
    fail("Microphone not allowed. Enable it for your terminal in System Settings → Privacy & Security → Microphone.")
  }
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)) else {
  fail("No speech recognizer for language \(lang)")
}

if command == "check" {
  authorize()
  emit([
    "event": "ok",
    "lang": lang,
    "onDevice": recognizer.supportsOnDeviceRecognition ? "true" : "false",
  ])
  exit(0)
}

if command == "transcribe" {
  guard let path = positional.first else { fail("Usage: transcribe <audio-file>") }
  authorize()
  let req = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
  req.contextualStrings = hints
  req.addsPunctuation = true
  if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
  let fileTask = recognizer.recognitionTask(with: req) { result, error in
    if let result, result.isFinal {
      emit(["event": "final", "text": result.bestTranscription.formattedString])
      exit(0)
    } else if let error {
      fail(error.localizedDescription)
    }
  }
  _ = fileTask
  dispatchMain()
}

guard command == "listen" else { fail("Unknown command: \(command)") }

authorize()
guard recognizer.isAvailable else { fail("Speech recognizer is not available right now") }

let request = SFSpeechAudioBufferRecognitionRequest()
request.shouldReportPartialResults = true
request.contextualStrings = hints
request.addsPunctuation = true
if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }

let engine = AVAudioEngine()
let input = engine.inputNode
let format = input.outputFormat(forBus: 0)
input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
  request.append(buffer)
}

var lastText = ""
var finished = false

func finish() {
  if finished { return }
  finished = true
  emit(["event": "final", "text": lastText])
  exit(0)
}

func stopListening() {
  if !engine.isRunning { return }
  engine.stop()
  input.removeTap(onBus: 0)
  request.endAudio()
  // Give the recognizer a moment to deliver the final result.
  DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { finish() }
}

let task = recognizer.recognitionTask(with: request) { result, error in
  if let result {
    let text = result.bestTranscription.formattedString
    DispatchQueue.main.async {
      lastText = text
      if result.isFinal { finish() } else { emit(["event": "partial", "text": text]) }
    }
  } else if let error {
    DispatchQueue.main.async {
      if engine.isRunning || lastText.isEmpty {
        // "No speech detected" ends with empty text rather than an error.
        let ns = error as NSError
        if ns.code == 1110 || ns.code == 301 { finish() }
        emit(["event": "error", "message": error.localizedDescription])
        exit(1)
      }
      finish()
    }
  }
}
_ = task

do {
  engine.prepare()
  try engine.start()
} catch {
  fail("Could not start microphone: \(error.localizedDescription)")
}
emit(["event": "ready"])

signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
for sig in [SIGINT, SIGTERM] {
  let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
  src.setEventHandler { stopListening() }
  src.resume()
  _ = Unmanaged.passRetained(src)
}

// Only watch stdin when it is a pipe/socket from the plugin; /dev/null would stop instantly.
var st = stat()
if fstat(0, &st) == 0 && [S_IFIFO, S_IFSOCK].contains(st.st_mode & S_IFMT) {
  Thread {
    while let line = readLine() {
      if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
    }
    DispatchQueue.main.async { stopListening() }
  }.start()
}

dispatchMain()
