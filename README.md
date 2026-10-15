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

Requires OpenCode 2. Add it to `~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-talk"]
}
```

Restart OpenCode. The first time you talk, macOS asks for **Microphone** and
**Speech Recognition** access for `opencode-talk-helper`. Allow both.

> Requires macOS 14+. For best results, turn on on-device dictation in
> System Settings → Keyboard → Dictation (downloads Apple's language model once).

## Use

One key does everything: **`ctrl+g`** (or `ctrl+x v`, or `/talk`).

| Do this           | What happens                                            |
| ----------------- | ------------------------------------------------------- |
| **Hold** `ctrl+g` | Talk while holding, release to insert                   |
| **Tap** `ctrl+g`  | Start listening; tap again or pause ~2 s to insert      |
| `ctrl+x v`        | Same as tapping; use this in Warp, which takes `ctrl+g` |
| `esc`             | Cancel while listening                                  |
| Say **"send it"** | Insert and submit in one go                             |

While you talk, a live `● 0:03 ▂▅▃▁ …your words…` line shows in the prompt footer.
The bars are the microphone level, so you can see it hears you. If the mic
picks up no sound at all (for example AirPods in their case), you get a warning.
The cleaned text is inserted at your cursor so you can review it before
pressing Enter. If the prompt box isn't focused, the text goes to the clipboard.

> Hold-to-talk works in any terminal: it detects the key-repeat stream your
> terminal sends while a key is held, so it doesn't need key-release events.

### What gets cleaned up

- Coding terms: "jason" → JSON, "bullion" → boolean, "cube control" → kubectl, "open code" → OpenCode…
- Naming: "camel case get user name" → `getUserName`, also snake, kebab, pascal and constant case
- Spoken punctuation: "comma", "period", "question mark", "new line", "backtick foo backtick"
- Fillers: um, uh, erm

These terms are also sent to Apple's recognizer as hints, which improves accuracy.

## Options

```json
{
  "plugins": [
    {
      "package": "opencode-talk",
      "options": {
        "keybind": "ctrl+g,<leader>v",
        "mic": "MacBook",
        "autoSend": false,
        "silenceStop": 2,
        "lang": "en-US",
        "vocab": { "acme db": "AcmeDB", "super base": "Supabase" }
      }
    }
  ]
}
```

- `keybind`: talk keys, comma-separated (default `ctrl+g,<leader>v`). Holding only works with a single chord like `ctrl+g`.
- `mic`: microphone to use, by name fragment, e.g. `"MacBook"` or `"AirPods"` (default: system input). List them with `bin/opencode-talk-helper mics`.
- `autoSend`: submit right after inserting (default `false`)
- `silenceStop`: seconds of silence before auto-stopping in tap mode; `0` disables (default `2`)
- `lang`: recognition language, e.g. `en-US`, `de-DE` (default: your system language)
- `vocab`: extra spoken → written replacements, also used as recognition hints
- `hints`: extra words to bias recognition without replacing anything

## How it works

```
OpenCode TUI ──► plugin (JS) ──spawn──► opencode-talk-helper (Swift)
                    ▲                        │ AVCaptureSession + SFSpeechRecognizer
                    └──── JSON lines ◄───────┘ (on-device)
```

The helper relaunches itself as its own "responsible" process, so the macOS
permission prompt names the helper and works from any terminal.

Helper protocol (stdout JSON lines): `ready`, `partial`, `final`, `error`.
Write `stop` to stdin to finish.

## Development

```bash
npm run build   # builds bin/opencode-talk-helper (universal, Swift 6 strict, ad-hoc signed)
npm test        # cleanup rules, push-to-talk logic, and helper integration tests
bin/opencode-talk-helper check                 # permissions + on-device support
bin/opencode-talk-helper mics                  # list microphones
bin/opencode-talk-helper transcribe clip.aiff  # transcribe a file
```

The helper is compiled with `-swift-version 6 -warnings-as-errors`, so
concurrency issues fail the build.

Test a local checkout by pointing `cli.json` at the folder:
`"plugins": ["/path/to/opencode-talk"]`.

## Roadmap

- Windows helper (WinRT `Windows.Media.SpeechRecognition`), same protocol
- Linux helper (Vosk, small one-time model download)
- macOS 26 `SpeechAnalyzer` backend for longer dictation
- Live text directly in the prompt box while talking
- Official prompt-insert API in OpenCode (currently inserts via the focused textarea)

## License

MIT
