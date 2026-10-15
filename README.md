<div align="center">

# 🎙 opencode-talk

**Talk instead of type in [OpenCode](https://opencode.ai/).**

Hold a key, say your prompt, let go. Your words appear in the prompt box as you speak.<br>
No downloads. No API keys. No extra programs. Recognized on-device.

[![CI](https://github.com/batuhansk/opencode-talk/actions/workflows/ci.yml/badge.svg)](https://github.com/batuhansk/opencode-talk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/opencode-talk)](https://www.npmjs.com/package/opencode-talk)
![macOS 14+](https://img.shields.io/badge/macOS-14%2B-black?logo=apple)
![OpenCode 2](https://img.shields.io/badge/OpenCode-2-blue)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

```text
┌──────────────────────────────────────────────────────────────┐
│ Add a null check to the JSON parser▌                         │
│ Build · Claude Opus 5.5 Anthropic · low                      │
└──────────────────────────────────────────────────────────────┘
 ● 0:04 ▂▅▇▃ release to insert
```

## Contents

- [Why](#why)
- [Install](#install)
- [Use](#use)
- [What gets cleaned up](#what-gets-cleaned-up)
- [Options](#options)
- [Speech engines](#speech-engines)
- [Troubleshooting](#troubleshooting)
- [Privacy](#privacy)
- [How it works](#how-it-works)
- [Development](#development)
- [Releasing](#releasing)
- [Roadmap](#roadmap)

## Why

Most voice setups for coding tools need whisper.cpp, sox, a ~600 MB model and an
LLM call on every prompt. opencode-talk uses the speech recognition already built
into macOS and cleans up coding terms with fast local rules.

|                              | opencode-talk          | Typical whisper-based plugin      |
| ---------------------------- | ---------------------- | --------------------------------- |
| Install                      | One plugin line        | Homebrew packages, Python, models |
| Download size                | ~90 kB package         | ~700 MB                           |
| API key / per-prompt AI call | None                   | Usually                           |
| Words appear while you speak | Yes, in the prompt box | No (record, then transcribe)      |
| Works offline                | Yes                    | Depends                           |

## Install

You need **OpenCode 2** and **macOS 14 (Sonoma) or later**.

Add the plugin to `~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-talk"]
}
```

Restart OpenCode. The first time you talk, macOS asks to allow **Microphone** and
**Speech Recognition** for `opencode-talk-helper`. Allow both.

## Use

| Do this                       | What happens                               |
| ----------------------------- | ------------------------------------------ |
| **Hold** `ctrl+y`             | Talk while holding; release to finish      |
| **Tap** `ctrl+y`              | Start; tap again, or pause ~2 s, to finish |
| `ctrl+x` then `v`, or `/talk` | Same as tapping (no hold)                  |
| `esc`                         | Cancel and remove what was said            |
| End with **"send it"**        | Finish and submit in one go                |

Your words appear **in the prompt box as you speak**, at your cursor, and get
corrected as the recognizer refines them. When you finish, the cleaned-up text
stays there so you can edit it before pressing Enter.

The footer shows a timer and a microphone level meter (`● 0:04 ▂▅▇▃`), so you
can see the mic is hearing you.

> [!TIP]
> Hold-to-talk works in any terminal. Terminals don't report key releases to
> OpenCode, so the plugin watches the key-repeat stream your terminal sends
> while a key is held. When it stops, you've let go.

> [!NOTE]
> If you type or move the cursor while talking, the plugin stops touching the
> prompt so it never overwrites your edits.

## What gets cleaned up

Recognizers don't know how developers talk. Local rules fix that, with no AI call:

| You say                                     | You get                        |
| ------------------------------------------- | ------------------------------ |
| "fix the **jason** parser"                  | Fix the **JSON** parser        |
| "make it a **bullion**"                     | Make it a **boolean**          |
| "run **cube control** get pods"             | Run **kubectl** get pods       |
| "rename it to **camel case get user name**" | Rename it to **`getUserName`** |
| "**snake case** max retry count"            | **`max_retry_count`**          |
| "**pascal case** user service"              | **`UserService`**              |
| "call **backtick** foo **backtick**"        | Call **`` `foo` ``**           |
| "first **comma** then **period**"           | First, then.                   |
| "**um** fix it"                             | Fix it                         |

Also supported: kebab case, constant case, "new line", "question mark",
"colon", "open/close paren", and 30+ common terms (GitHub, TypeScript, Node.js,
README, .env, PR, API, SQL, YAML, GraphQL, Postgres, OpenCode, ...).
These terms are also sent to the recognizer as hints, which improves accuracy.
Add your own with the [`vocab`](#options) option.

## Options

Pass options with the object form in `cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "opencode-talk",
      "options": {
        "keybind": "ctrl+y,<leader>v",
        "mic": "MacBook",
        "liveText": true,
        "autoSend": false,
        "silenceStop": 2,
        "engine": "auto",
        "lang": "en-US",
        "vocab": { "acme db": "AcmeDB", "super base": "Supabase" },
        "hints": ["Drizzle", "tRPC"]
      }
    }
  ]
}
```

| Option        | Default              | Description                                                                                                  |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `keybind`     | `"ctrl+y,<leader>v"` | Talk keys, comma-separated. Hold only works with a single chord like `ctrl+y`.                               |
| `mic`         | system input         | Microphone by name fragment, e.g. `"MacBook"`, `"AirPods"`. List with `opencode-talk-helper mics`.           |
| `liveText`    | `true`               | Show words in the prompt while you speak. When `false`, they show in the footer and are inserted at the end. |
| `autoSend`    | `false`              | Submit right after finishing, without saying "send it".                                                      |
| `silenceStop` | `2`                  | Seconds of silence before finishing in tap mode. `0` disables.                                               |
| `engine`      | `"auto"`             | `auto`, `dictation` (macOS 26) or `legacy`. See [Speech engines](#speech-engines).                           |
| `lang`        | system language      | Recognition language, e.g. `"en-US"`, `"de-DE"`, `"tr-TR"`.                                                  |
| `vocab`       | `{}`                 | Extra spoken → written replacements. Also used as recognition hints.                                         |
| `hints`       | `[]`                 | Extra words to bias recognition, without replacing anything.                                                 |

## Speech engines

opencode-talk picks the best engine available, automatically:

| Engine      | macOS | Notes                                                                                                  |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `dictation` | 26+   | Apple's newer on-device dictation model (`SpeechAnalyzer`). Installed once by macOS in the background. |
| `legacy`    | 14+   | `SFSpeechRecognizer`, on-device when your language supports it.                                        |

On macOS 26 the plugin asks macOS to install the dictation model on first start.
Until it's ready, the legacy engine is used. Force one with the `engine` option.

## Troubleshooting

<details>
<summary><b>I talk but nothing happens</b></summary>

Watch the level meter in the footer while you talk.

- **Bars don't move:** the mic hears nothing. If you get a warning naming your
  mic (for example "AirPods Pro isn't picking up any sound"), the device is
  connected but silent: AirPods in their case, a muted headset, or a closed
  MacBook lid (which turns off the built-in mic). Pick another one with the
  `mic` option.
- **Bars move, no words:** check System Settings → Privacy & Security →
  Speech Recognition, and that `lang` matches the language you speak.

</details>

<details>
<summary><b>The key does nothing, or opens something else</b></summary>

Your terminal may use that key for itself. For example, Warp and OpenCode both
use `ctrl+g`, which is why the default is `ctrl+y`. Use `ctrl+x v` or `/talk`,
or set another `keybind`.

</details>

<details>
<summary><b>No permission prompt appeared / permission denied</b></summary>

Open System Settings → Privacy & Security → **Microphone** and **Speech
Recognition**, and allow `opencode-talk-helper`. Then check from a terminal:

```bash
~/.cache/opencode/packages/opencode-talk/bin/opencode-talk-helper check
```

(The path depends on where OpenCode installed the package.)

</details>

<details>
<summary><b>Words land in the clipboard instead of the prompt</b></summary>

That happens when the prompt box isn't focused when you start talking. Press
`⌘V` to paste, and click into the prompt before talking next time.

</details>

## Privacy

Speech is recognized on your Mac. The plugin itself makes no network requests
and has no telemetry. The only download is Apple's own dictation model on
macOS 26, managed by macOS.

One exception: for a language that macOS can't recognize on-device, the
`legacy` engine falls back to Apple's speech servers (Apple's standard
Siri/Dictation privacy terms apply). English and most major languages are
on-device. `opencode-talk-helper check` shows `"onDevice":"true"` when yours is.

## How it works

```text
OpenCode 2 CLI
  └─ tui.js           keys (ctrl+y, ctrl+x v, /talk, esc) · footer indicator
       ├─ lib/live.js        types words into the prompt as they arrive
       ├─ lib/ptt.js         tap vs. hold, from key repeats
       ├─ lib/clean.js       coding terms, naming styles, punctuation, "send it"
       ├─ lib/indicator.js   ● timer · level meter
       └─ lib/helper.js ──spawn──▶ opencode-talk-helper (Swift 6)
                          ◀─JSON──  microphone (AVCaptureSession)
                                    → DictationTranscriber (macOS 26) or SFSpeechRecognizer
```

The helper speaks JSON lines on stdout (`ready`, `level`, `partial`, `final`,
`error`) and finishes when it reads `stop` on stdin. It never leaves the
microphone on: signals end it immediately, it exits if its parent goes away,
and every session is capped at 10 minutes.

It relaunches itself as its own "responsible" process so the macOS permission
prompt names the helper and works from any terminal.

## Development

```bash
git clone https://github.com/batuhansk/opencode-talk && cd opencode-talk
npm run build   # universal helper binary, Swift 6 strict, warnings as errors
npm test        # cleanup rules, live preview, push-to-talk, helper end-to-end
```

Point `cli.json` at your checkout to try it in OpenCode:

```json
{ "plugins": ["/path/to/opencode-talk"] }
```

Helper commands:

```bash
bin/opencode-talk-helper check                         # permissions, active engine
bin/opencode-talk-helper mics                          # list microphones
bin/opencode-talk-helper prepare                       # install the macOS 26 model
bin/opencode-talk-helper listen --engine dictation     # talk; type "stop" + Enter
bin/opencode-talk-helper transcribe clip.aiff          # transcribe a file
```

Set `OPENCODE_TALK_DEBUG=1` for diagnostics on stderr, and
`OPENCODE_TALK_TEST_FILE=clip.aiff` to stream a file through the live pipeline
instead of the microphone (used by the tests).

Helper tests need Speech Recognition permission, so they skip on CI.

## Releasing

GitHub Actions does the work:

- **CI** on every push and pull request: builds on macOS 14 and 15, verifies a
  signed universal binary, runs the tests, checks formatting and package contents.
- **Release** on a `v*` tag: checks the tag matches `package.json`, builds,
  tests, publishes to npm with provenance, and creates a GitHub Release with the
  helper attached and notes from `CHANGELOG.md`.

```bash
npm version minor        # bumps package.json and creates the tag
git push --follow-tags   # GitHub Actions publishes
```

One-time setup: on npmjs.com, add this repo as a trusted publisher for
`opencode-talk` (workflow `release.yml`, environment `npm`), or add an
`NPM_TOKEN` repository secret.

## Roadmap

- Project-aware vocabulary: file names and identifiers from your repo as hints
- Windows helper (`Windows.Media.SpeechRecognition`), same JSON protocol
- Linux helper (Vosk, small one-time model)
- An official OpenCode API for editing the prompt (today the plugin edits the focused text box directly)

Ideas and pull requests welcome: [open an issue](https://github.com/batuhansk/opencode-talk/issues).

## License

MIT © [Batuhan Saka](https://github.com/batuhansk)
