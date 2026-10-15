# opencode-talk

Talk instead of type in [OpenCode](https://opencode.ai/).

Press a key, speak your prompt, press it again, and your words land in the
prompt box. That's it: **no downloads, no API keys, no extra programs**. It uses
the on-device speech recognition built into macOS.

## Why

Other voice plugins need whisper.cpp, sox, a ~600 MB model, and an LLM API call
on every prompt. opencode-talk ships one ~200 KB native helper and cleans up
coding terms with local rules, so it's fast and works offline.

## Install

Add it to `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-talk"]
}
```

Restart OpenCode. The first time you talk, macOS asks for **Microphone** and
**Speech Recognition** access for `opencode-talk-helper`. Allow both.

> Requires macOS 13+. For best results, turn on on-device dictation in
> System Settings → Keyboard → Dictation (downloads Apple's language model once).

## Use

| Action              | Key          | Command        |
| ------------------- | ------------ | -------------- |
| Start / stop talking | `ctrl+x v`  | `/talk`        |
| Stop and send        | `ctrl+x j`  | `/talk-send`   |
| Cancel               |             | `/talk-cancel` |

While you talk, the live transcript shows in a toast. When you stop, the
cleaned text is added to the prompt so you can edit it before sending.

**Say "send it"** at the end to submit right away.

### What gets cleaned up

- Coding terms: "jason" → JSON, "bullion" → boolean, "cube control" → kubectl, "open code" → OpenCode…
- Naming: "camel case get user name" → `getUserName`, also snake, kebab, pascal and constant case
- Spoken punctuation: "comma", "period", "question mark", "new line", "backtick foo backtick"
- Fillers: um, uh, erm

These terms are also sent to Apple's recognizer as hints, which improves accuracy.

## Options

```json
{
  "plugin": [
    ["opencode-talk", {
      "keybind": "<leader>v",
      "sendKeybind": "<leader>j",
      "lang": "en-US",
      "vocab": { "acme db": "AcmeDB", "super base": "Supabase" }
    }]
  ]
}
```

- `keybind`: start/stop talking (default `<leader>v`)
- `sendKeybind`: stop and submit (default `<leader>j`)
- `lang`: recognition language, e.g. `en-US`, `de-DE` (default: your system language)
- `vocab`: extra spoken → written replacements, also used as recognition hints
- `hints`: extra words to bias recognition without replacing anything

## How it works

```
OpenCode TUI ──► plugin (JS) ──spawn──► opencode-talk-helper (Swift)
                    ▲                        │ AVAudioEngine + SFSpeechRecognizer
                    └──── JSON lines ◄───────┘ (on-device)
```

The helper relaunches itself as its own "responsible" process, so the macOS
permission prompt names the helper and works from any terminal.

Helper protocol (stdout JSON lines): `ready`, `partial`, `final`, `error`.
Write `stop` to stdin to finish.

## Development

```bash
npm run build   # builds bin/opencode-talk-helper (universal, ad-hoc signed)
npm test
bin/opencode-talk-helper check                 # permissions + on-device support
bin/opencode-talk-helper transcribe clip.aiff  # transcribe a file
```

Test a local checkout by pointing `tui.json` at the folder:
`"plugin": ["/path/to/opencode-talk"]`.

## Roadmap

- Windows helper (WinRT `Windows.Media.SpeechRecognition`), same protocol
- Linux helper (Vosk, small one-time model download)
- macOS 26 `SpeechAnalyzer` backend for longer dictation
- Live text directly in the prompt box (needs an OpenCode API for replacing prompt text)

## License

MIT
