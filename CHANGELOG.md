# Changelog

## 0.1.0 (unreleased)

First release, for OpenCode 2 on macOS 14+.

- Talk instead of type: hold or tap `ctrl+y`, or use `ctrl+x v` / `/talk`
- Words appear in the prompt box as you speak, at your cursor; your own edits are never overwritten
- Any language your Mac can recognize (63 on macOS 26): defaults to your System Settings languages, switch with `/talk:language`, add more from "More languages…"; the choice is remembered
- On-device only by default: audio never leaves your Mac unless you set `onDeviceOnly: false`
- Two on-device speech engines: Apple's dictation model on macOS 26 (`SpeechAnalyzer`), `SFSpeechRecognizer` on macOS 14+; macOS 26 models install in the background
- Local cleanup for coding terms in every language, plus naming styles (camel, snake, pascal, kebab, constant), spoken punctuation and fillers in English and Turkish
- Say "send it" ("gönder" in Turkish) to submit, or enable `autoSend`
- Footer with timer, microphone level meter and active language; warning when the mic picks up no sound
- Options: `keybind`, `languages`, `languageKeybind`, `onDeviceOnly`, `mic`, `engine`, `liveText`, `autoSend`, `silenceStop`, `vocab`, `hints`
- Native Swift 6 helper that never leaves the microphone on
