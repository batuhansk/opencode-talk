<div align="center">

<img src="https://raw.githubusercontent.com/batuhansk/opencode-talk/main/docs/header.png" alt="opencode-talk: talk instead of type. A voice waveform turns into code and flows into a terminal prompt." width="100%">

**Talk instead of type in [OpenCode](https://opencode.ai/).**

Hold a key, say your prompt, let go. Your words appear in the prompt box as you speak.<br>
No downloads. No API keys. No extra programs. 60+ languages, recognized on-device.

[![CI](https://github.com/batuhansk/opencode-talk/actions/workflows/ci.yml/badge.svg)](https://github.com/batuhansk/opencode-talk/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/opencode-talk)](https://www.npmjs.com/package/opencode-talk) ![macOS 14+](https://img.shields.io/badge/macOS-14%2B-black?logo=apple) ![OpenCode 2](https://img.shields.io/badge/OpenCode-2-blue) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

<!-- Optional: add a short screen recording (docs/demo.gif) of holding ctrl+y and talking. -->

## Contents

- [Features](#features)
- [Why](#why)
- [Install](#install)
- [Use](#use)
- [What gets cleaned up](#what-gets-cleaned-up)
- [Languages](#languages)
- [Settings](#settings)
- [Speech engines](#speech-engines)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Privacy](#privacy)
- [How it works](#how-it-works)
- [Development](#development)
- [Releasing](#releasing)
- [Roadmap](#roadmap)

## Features

- 🎙 **Hold or tap to talk.** `ctrl+y` (hold to talk, or tap and pause), `ctrl+x v`, or `/talk`. `esc` cancels.
- ⚡ **Words appear as you speak**, right at your cursor, and get corrected as you go. Your own edits are never overwritten.
- 🧠 **Talks like a developer.** "jason" → JSON, "camel case get user" → `getUser`, spoken punctuation, filler words removed. No AI call.
- 🌍 **60+ languages.** Uses your macOS languages by default; switch with `/talk:language` or add any language your Mac supports.
- 🔒 **Private by default.** Recognition runs on your Mac; audio never leaves it unless you allow it.
- 🗣 **Natural dictation.** Pause between sentences and keep going; every sentence is kept. Say "send it" to submit.
- 📶 **Clear feedback.** The footer shows a timer, mic level, language and what to press next; a warning tells you if the mic hears nothing.
- ⚙️ **Change anything from the chat.** `/talk:settings`, `/talk:mic`, `/talk:keybind`, `/talk:language`; changes apply immediately and are remembered.
- 🪶 **Zero setup.** One plugin line. No Homebrew packages, models or keys. Apple's newer engine on macOS 26 is used automatically.

## Why

Most voice setups for coding tools need whisper.cpp, sox, a ~600 MB model and an
LLM call on every prompt. opencode-talk uses the speech recognition already built
into macOS and cleans up coding terms with fast local rules.

|                              | opencode-talk             | Typical whisper-based plugin      |
| ---------------------------- | ------------------------- | --------------------------------- |
| Install                      | One plugin line           | Homebrew packages, Python, models |
| Download size                | ~225 kB package           | ~700 MB                           |
| API key / per-prompt AI call | None                      | Usually                           |
| Words appear while you speak | Yes, in the prompt box    | No (record, then transcribe)      |
| Languages                    | 60+, switch any time      | Depends on the model              |
| Works offline                | Yes, on-device by default | Depends                           |

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

That's all the setup there is. It listens in your macOS language; see
[Languages](#languages) to add or switch languages.

## Use

| Do this                       | What happens                                      |
| ----------------------------- | ------------------------------------------------- |
| **Hold** `ctrl+y`             | Talk while holding; release to finish             |
| **Tap** `ctrl+y`              | Start; press again, or pause ~2 s, to finish      |
| `ctrl+x` then `v`, or `/talk` | Same as tapping (no hold)                         |
| `esc`                         | Cancel and remove what was said                   |
| `/talk:language`              | Switch the language you speak                     |
| `/talk:mic`                   | Choose the microphone                             |
| `/talk:keybind`               | Change the talk key                               |
| `/talk:settings`              | Everything else, plus reset                       |
| End with **"send it"**        | Finish and submit in one go ("gönder" in Turkish) |

Your words appear **in the prompt box as you speak**, at your cursor, and get
corrected as the recognizer refines them. Pause between sentences as you like;
every sentence is kept. When you finish, the cleaned-up text stays there so you
can edit it before pressing Enter.

The footer shows a timer, the microphone level and the active language, plus
what to do next, so you always know the mic is hearing you. If the mic picks up
no sound at all, you get a warning naming it.

```text
● 0:04 ▂▅▇▃ EN ctrl+y or pause to finish · esc cancels
```

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
Add your own with the [`vocab`](#settings) option.

## Languages

Apple's speech engines recognize **one language at a time** and don't detect
which language you're speaking, so, like macOS Dictation, you pick it:

- **By default** you get the preferred languages from System Settings →
  General → Language & Region that Apple can recognize. Set `languages` to
  choose your own list.
- **Switch** with `/talk:language` (or the command palette, or a key via
  `languageKeybind`). It shows each language and whether it runs on-device.
- **Any language your Mac supports:** pick **More languages…** in the same
  picker to search every language Apple can recognize (63 on macOS 26) and add
  one. Added languages stay in the picker; press `ctrl+d` on one to remove it.
- **Your choice is remembered** across restarts, and the footer shows the
  active one, e.g. `● 0:03 ▂▅▇ DE`.
- **Models download automatically.** On macOS 26, Apple's on-device dictation
  model is installed for each of your languages in the background.

```json
{ "package": "opencode-talk", "options": { "languages": ["en-US", "de-DE", "ja-JP"] } }
```

Cleanup follows the active language. Tech terms like JSON are fixed in every
language. Spoken punctuation and the "send it" command currently exist for
English and Turkish ("virgül", "nokta", "soru işareti", "yeni satır",
"gönder"); in other languages, the recognizer's own punctuation is kept.

To see what your Mac supports:

```bash
opencode-talk-helper languages          # your System Settings languages
opencode-talk-helper languages --all    # everything this Mac can recognize
```

## Settings

Change settings **in the chat**. They apply immediately and are remembered:

| Command          | What you can change                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `/talk:settings` | One menu for everything below, plus **Reset to defaults**                                    |
| `/talk:language` | Language you speak; **More languages…** adds any supported one                               |
| `/talk:mic`      | Microphone, or System default                                                                |
| `/talk:keybind`  | Talk key. Warns if OpenCode or your terminal already uses it (e.g. `ctrl+g`) before applying |

All commands are also in the command palette (`ctrl+p`), under **Voice**.

You can also set defaults in `cli.json`. A change made in the chat overrides
`cli.json` until you choose **Reset to defaults** in `/talk:settings`.

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
        "languages": ["en-US", "de-DE"],
        "onDeviceOnly": true,
        "vocab": { "acme db": "AcmeDB", "super base": "Supabase" },
        "hints": ["Drizzle", "tRPC"]
      }
    }
  ]
}
```

| Option            | Default              | In chat          | Description                                                                                       |
| ----------------- | -------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| `keybind`         | `"ctrl+y,<leader>v"` | `/talk:keybind`  | Talk keys, comma-separated. Hold only works with a single chord like `ctrl+y`.                    |
| `mic`             | system input         | `/talk:mic`      | Microphone by name fragment, e.g. `"MacBook"`, `"AirPods"`.                                       |
| `languages`       | System Settings      | `/talk:language` | Languages you speak, e.g. `["en-US", "de-DE"]`. See [Languages](#languages).                      |
| `liveText`        | `true`               | `/talk:settings` | Show words in the prompt while you speak. When `false`, they show in the footer until you finish. |
| `autoSend`        | `false`              | `/talk:settings` | Submit right after finishing, without saying "send it".                                           |
| `silenceStop`     | `2`                  | `/talk:settings` | Seconds of silence before finishing in tap mode. `0` turns it off.                                |
| `engine`          | `"auto"`             | `/talk:settings` | `auto`, `dictation` (macOS 26) or `legacy`. See [Speech engines](#speech-engines).                |
| `onDeviceOnly`    | `true`               | `/talk:settings` | Never send audio to Apple's servers. `false` allows them for languages without on-device support. |
| `languageKeybind` | none                 | —                | Optional key that opens the language picker.                                                      |
| `vocab`           | `{}`                 | —                | Extra spoken → written replacements. Also used as recognition hints.                              |
| `hints`           | `[]`                 | —                | Extra words to bias recognition, without replacing anything.                                      |

## Speech engines

opencode-talk picks the best engine available, automatically:

| Engine      | macOS | Notes                                                                                                  |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `dictation` | 26+   | Apple's newer on-device dictation model (`SpeechAnalyzer`). Installed once by macOS in the background. |
| `legacy`    | 14+   | `SFSpeechRecognizer`, on-device when your language supports it.                                        |

On macOS 26 the plugin asks macOS to install the dictation model for each of
your languages on start. If a language has no on-device legacy support, the
model is downloaded before the first talk. Force an engine with the `engine` option.

## Limitations

- **macOS only** for now (14 Sonoma or later). Windows and Linux are on the [roadmap](#roadmap).
- **One language at a time.** Apple's engines don't detect the spoken language; switch with `/talk:language`.
- **Spoken punctuation** ("comma", "virgül") and "send it" exist in English and Turkish. Other languages keep the recognizer's own punctuation; coding terms are fixed in all.
- **Hold-to-talk needs a single key** like `ctrl+y`. Two-step keys such as `ctrl+x v` work as tap only.
- **Live text edits the prompt box directly**, because OpenCode doesn't yet have a plugin API for it. A future OpenCode update could require a plugin update.
- **macOS may ask for permission again after updating** the plugin, until the helper is signed with an Apple Developer ID.

## Troubleshooting

<details>
<summary><b>I talk but nothing happens</b></summary>

Watch the level meter in the footer while you talk.

- **Bars don't move:** the mic hears nothing. If you get a warning naming your
  mic (for example "AirPods Pro isn't picking up any sound"), the device is
  connected but silent: AirPods in their case, a muted headset, or a closed
  MacBook lid (which turns off the built-in mic). Pick another one with
  `/talk:mic`.
- **Bars move, no words:** check System Settings → Privacy & Security →
  Speech Recognition, and that the footer shows the language you're speaking
  (switch with `/talk:language`).

</details>

<details>
<summary><b>Words come out wrong in another language</b></summary>

The recognizer only understands the active language. Speaking, say, German
while English is active produces English-sounding nonsense. Switch with
`/talk:language`, or add the language to `languages` (or to System Settings →
Language & Region).

</details>

<details>
<summary><b>The key does nothing, or opens something else</b></summary>

Your terminal may use that key for itself. For example, Warp and OpenCode both
use `ctrl+g`, which is why the default is `ctrl+y`. Use `ctrl+x v` or `/talk`,
or pick another key with `/talk:keybind` (it warns about keys already in use).

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
<summary><b>Something else looks wrong</b></summary>

Start OpenCode with a debug trace, reproduce it once, and attach the log to an
[issue](https://github.com/batuhansk/opencode-talk/issues):

```bash
OPENCODE_TALK_DEBUG=1 opencode
# then: ~/Library/Logs/opencode-talk.log
```

If you've updated the plugin while OpenCode was running, restart OpenCode first.

</details>

<details>
<summary><b>Words land in the clipboard instead of the prompt</b></summary>

That happens when the prompt box isn't focused when you start talking. Press
`⌘V` to paste, and click into the prompt before talking next time.

</details>

## Privacy

Speech is recognized on your Mac. The plugin makes no network requests and has
no telemetry. The only downloads are Apple's own on-device dictation models on
macOS 26, managed by macOS.

By default (`onDeviceOnly: true`) audio never leaves your Mac: if a language
can't run on-device, the plugin tells you instead of using Apple's servers.
Setting `onDeviceOnly: false` allows Apple's servers for such languages
(Apple's Siri/Dictation privacy terms apply).

## How it works

```mermaid
flowchart LR
  you(["🧑 You"])
  plugin["<b>Plugin</b><br/>in OpenCode 2"]
  helper["<b>Native helper</b><br/>Swift 6 · microphone"]
  engine{{"<b>On-device speech</b><br/>macOS 26: DictationTranscriber<br/>macOS 14+: SFSpeechRecognizer"}}
  prompt[("Prompt box")]
  footer["Footer<br/>● timer · level · language"]

  you -- "hold ctrl+y" --> plugin
  plugin <-- "JSON lines" --> helper
  helper <-- "audio · text" --> engine
  plugin -- "live words" --> prompt
  plugin --> footer
```

| Part                | Does                                                                |
| ------------------- | ------------------------------------------------------------------- |
| `tui.js`            | Keys, commands, language/mic/key pickers and the settings menu      |
| `lib/settings.js`   | Chat settings over cli.json defaults; key validation and conflicts  |
| `lib/live.js`       | Types words into the prompt as they arrive; backs off if you edit   |
| `lib/clean.js`      | Coding terms, naming styles, punctuation and "send it" per language |
| `lib/ptt.js`        | Tells tap from hold using key repeats                               |
| `lib/indicator.js`  | Footer: timer, level meter, language and next-step hint             |
| `lib/helper.js`     | Runs the helper and reads its JSON events                           |
| `helper/main.swift` | Microphone, both speech engines, stitching sentences across pauses  |

What happens when you hold the key:

```mermaid
sequenceDiagram
  autonumber
  actor You
  participant P as Plugin
  participant H as Helper
  participant M as Speech engine
  participant B as Prompt box

  You->>P: hold ctrl+y
  P->>H: start (spawn)
  H->>M: microphone audio
  H-->>P: ready, level…
  loop while you speak
    M-->>H: revised text (sentences kept across pauses)
    H-->>P: partial
    P->>P: clean up ("jason" → JSON)
    P->>B: replace only what changed
  end
  You->>P: release ctrl+y
  P->>H: stop
  H-->>P: final
  P->>B: final cleaned text
  Note over P,B: "send it" at the end also submits
```

The helper never leaves the microphone on: signals end it immediately, it
exits if its parent goes away, and every session is capped at 10 minutes. It
relaunches itself as its own "responsible" process so the macOS permission
prompt names the helper and works from any terminal.

## Development

```bash
git clone https://github.com/batuhansk/opencode-talk && cd opencode-talk
npm run build   # universal helper binary, Swift 6 strict, warnings as errors
npm test        # cleanup, live preview, push-to-talk, languages, plugin, helper end-to-end
```

Point `cli.json` at your checkout to try it in OpenCode:

```json
{ "plugins": ["/path/to/opencode-talk"] }
```

Helper commands:

```bash
bin/opencode-talk-helper check                              # permissions, active engine
bin/opencode-talk-helper languages [--all]                  # your languages / every supported one
bin/opencode-talk-helper mics                               # list microphones
bin/opencode-talk-helper prepare --lang de-DE --lang ja-JP  # install macOS 26 models
bin/opencode-talk-helper listen --lang de-DE                # talk; type "stop" + Enter
bin/opencode-talk-helper transcribe clip.aiff --engine legacy
```

Common flags: `--lang`, `--engine auto|dictation|legacy`, `--mic <name>`,
`--hint <word>`, and `--allow-cloud` (permit Apple's servers for languages
without on-device support).

Environment: set `OPENCODE_TALK_DEBUG=1` for diagnostics (helper: stderr; plugin:
`~/Library/Logs/opencode-talk.log`), and
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
- Spoken punctuation and voice commands for more languages (English and Turkish today; contributions welcome)
- Developer ID signing and notarization, so macOS doesn't ask for permission again after updates
- Windows helper (`Windows.Media.SpeechRecognition`), same JSON protocol
- Linux helper (Vosk, small one-time model)
- An official OpenCode API for editing the prompt (today the plugin edits the focused text box directly)

Ideas and pull requests welcome: [open an issue](https://github.com/batuhansk/opencode-talk/issues).

## License

MIT © [Batuhan Saka](https://github.com/batuhansk)
