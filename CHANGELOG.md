# Changelog

## 0.1.0 (unreleased)

First release, for OpenCode 2 on macOS 14+.

- Talk instead of type: hold or tap `ctrl+y`, or use `ctrl+x v` / `/talk`
- Words appear in the prompt box as you speak, at your cursor; your own edits are never overwritten
- Two on-device speech engines: Apple's newer dictation model on macOS 26 (`SpeechAnalyzer`), `SFSpeechRecognizer` on macOS 14+
- No downloads, no API keys; the macOS 26 model is installed by macOS in the background
- Local cleanup for coding terms, naming styles (camel, snake, pascal, kebab, constant), spoken punctuation and fillers
- Say "send it" to submit, or enable `autoSend`
- Footer with timer and microphone level meter; warning when the mic picks up no sound
- `mic`, `engine`, `liveText`, `lang`, `vocab`, `hints`, `keybind`, `silenceStop` options
- Native Swift 6 helper that never leaves the microphone on
