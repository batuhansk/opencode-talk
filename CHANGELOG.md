# Changelog

## 0.1.1 (2026-10-15)

- Releases are now staged on npm through trusted publishing (no tokens) and go live only after a maintainer approves them with a passkey or 2FA
- CI builds the helper once with Xcode 26 and tests that binary on macOS 14, 15 and 26
- README: updated Releasing section

## 0.1.0 (2026-10-15)

First release, for OpenCode 2 on macOS 14+.

- Talk instead of type: hold or tap `ctrl+y`, or use `ctrl+x v` / `/talk`
- Words appear in the prompt box as you speak, at your cursor; your own edits are never overwritten
- Any language your Mac can recognize (63 on macOS 26): defaults to your System Settings languages, switch with `/talk:language`, add more from "More languages…"; the choice is remembered
- On-device only by default: audio never leaves your Mac unless you set `onDeviceOnly: false`
- Two on-device speech engines: Apple's dictation model on macOS 26 (`SpeechAnalyzer`), `SFSpeechRecognizer` on macOS 14+; macOS 26 models install in the background
- Local cleanup for coding terms in every language, plus naming styles (camel, snake, pascal, kebab, constant), spoken punctuation and fillers in English and Turkish
- Say "send it" ("gönder" in Turkish) to submit, or enable `autoSend`
- Footer with timer, microphone level meter and active language; warning when the mic picks up no sound
- Change settings in the chat: `/talk:settings`, `/talk:mic`, `/talk:keybind` (warns about keys already in use), `/talk:language`; applied immediately, remembered, and resettable to the `cli.json` defaults
- Options: `keybind`, `languages`, `languageKeybind`, `onDeviceOnly`, `mic`, `engine`, `liveText`, `autoSend`, `silenceStop`, `vocab`, `hints`
- Native Swift 6 helper that never leaves the microphone on
