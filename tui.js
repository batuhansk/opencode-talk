// opencode-talk: talk instead of type in OpenCode (v2 CLI plugin).
//
// One key does everything:
//   tap  ctrl+y / ctrl+x v  start; tap again (or pause) to insert
//   hold ctrl+y             talk while holding; release to insert
//   esc                     cancel while listening
// End with "send it" to submit, or set autoSend.
//
// Options (cli.json):
//   { "package": "opencode-talk", "options": {
//       "keybind": "ctrl+y,<leader>v",    // talk keys; a single chord like ctrl+y also supports holding
//       "mic": "MacBook",                 // microphone name fragment; default: system input
//       "autoSend": false,                // submit after inserting
//       "silenceStop": 2,                 // seconds of silence before auto-stop in tap mode; 0 disables
//       "liveText": true,                 // show words in the prompt while talking
//       "engine": "auto",                 // auto | dictation (macOS 26) | legacy
//       "languages": ["en-US", "tr-TR"],  // switch with /talk:language; default: System Settings
//       "onDeviceOnly": true,             // never send audio to Apple's servers
//       "vocab": { "acme db": "AcmeDB" }  // extra spoken -> written terms
//   } }

import { Plugin } from "@opencode/plugin/tui"
import { spawn } from "node:child_process"
import { buildVocab, clean, extractSend } from "./lib/clean.js"
import { listLanguages, prepareEngine, startListening } from "./lib/helper.js"
import { createIndicator } from "./lib/indicator.js"
import { createLivePreview } from "./lib/live.js"
import { createPushToTalk } from "./lib/ptt.js"

const NO_SPEECH_TIMEOUT = 8000
const NO_AUDIO_CHECK = 2500
const NO_AUDIO_LEVEL = 0.05

function copyToClipboard(text) {
  return new Promise((resolve) => {
    const p = spawn("pbcopy")
    p.on("close", (code) => resolve(code === 0))
    p.on("error", () => resolve(false))
    p.stdin.end(text)
  })
}

export default Plugin.define({
  id: "opencode-talk",
  async setup(context) {
    const options = context.options ?? {}
    const vocab = buildVocab(options.vocab)
    const hints = [...vocab.hints, ...(options.hints ?? [])].slice(0, 100)
    const silenceMs = (options.silenceStop ?? 2) * 1000

    let session = null
    let target = null
    let silenceTimer = null
    let audioTimer = null
    let heardSomething = false
    let loudest = 0
    const live = createLivePreview()
    const liveText = options.liveText !== false
    const allowCloud = options.onDeviceOnly === false

    // Languages: from options, else the preferred languages in System
    // Settings that Apple can recognize. The active one is remembered.
    // Languages added from "More languages…" are remembered too.
    const [settings, updateSettings] = context.storage.store("settings", {
      initial: { language: null, added: [] },
    })
    const configured = options.languages ?? (options.lang ? [options.lang] : [])
    const base = (await listLanguages(configured).catch(() => [])).filter((l) => l.supported)
    const added = (settings.added ?? []).length
      ? (await listLanguages(settings.added).catch(() => [])).filter((l) => l.supported)
      : []
    let languages = [...base, ...added.filter((a) => !base.some((b) => b.lang === a.lang))]
    if (languages.length === 0) languages = [{ lang: configured[0], name: configured[0] ?? "System language" }]
    let allLanguages = null // loaded on demand; listing every language takes a few seconds
    const activeLanguage = () => languages.find((l) => l.lang === settings.language) ?? languages[0]
    const shortCode = (lang) => (lang ?? "").split(/[-_]/)[0].toUpperCase()

    // On macOS 26, install Apple's dictation models in the background so the
    // first talk in each language is fast and on-device.
    prepareEngine(languages.map((l) => l.lang).filter(Boolean)).catch(() => {})

    const MORE = "\u0000more"
    const describeLanguage = (l) =>
      l.onDevice ? "On-device" : allowCloud ? "Uses Apple's servers" : "Not available on-device"
    const languageOption = (l) => ({
      title: l.name,
      value: l.lang,
      description: describeLanguage(l),
      disabled: !l.onDevice && !allowCloud,
    })

    async function chooseLanguage(lang) {
      if (!languages.some((l) => l.lang === lang)) {
        const extra = allLanguages?.find((l) => l.lang === lang)
        if (extra) languages = [...languages, extra]
      }
      await updateSettings((draft) => {
        draft.language = lang
        if (!configured.includes(lang) && !base.some((b) => b.lang === lang)) {
          draft.added = [...new Set([...(draft.added ?? []), lang])]
        }
      })
      prepareEngine([lang]).catch(() => {})
      toast(`Talk language: ${languages.find((l) => l.lang === lang)?.name ?? lang}`, "success", 1500)
    }

    async function removeLanguage(lang) {
      if (!(settings.added ?? []).includes(lang)) {
        return toast("Only languages added from “More languages…” can be removed here", "info", 3000)
      }
      languages = languages.filter((l) => l.lang !== lang)
      await updateSettings((draft) => {
        draft.added = (draft.added ?? []).filter((l) => l !== lang)
        if (draft.language === lang) draft.language = null
      })
      context.ui.dialog.clear()
      toast("Removed", "info", 1200)
    }

    async function pickLanguage() {
      const picked = await context.ui.dialog.select({
        title: "Talk language",
        current: activeLanguage()?.lang,
        options: [
          ...languages.map(languageOption),
          { title: "More languages…", value: MORE, description: "Every language this Mac can recognize" },
        ],
        actions: [{ bind: "ctrl+d", title: "Remove", onTrigger: (lang) => lang !== MORE && removeLanguage(lang) }],
      })
      if (!picked) return
      if (picked !== MORE) return chooseLanguage(picked)

      if (!allLanguages) {
        toast("Loading languages…", "info", 4000)
        allLanguages = (await listLanguages([], { all: true }).catch(() => [])).filter((l) => l.supported)
      }
      const lang = await context.ui.dialog.select({
        title: "All languages (type to search)",
        current: activeLanguage()?.lang,
        options: allLanguages.map(languageOption),
      })
      if (lang) await chooseLanguage(lang)
    }

    const toast = (message, variant = "info", duration = 2500) =>
      context.ui.toast.show({ title: "Talk", message, variant, duration })

    const indicator = await createIndicator(context).catch(() => null)
    const status = {
      show(s) {
        if (indicator) return indicator.show(s)
        if (s.phase === "listening" && !s.text) toast("🎙 Listening… tap again or press esc", "info", 60000)
        else if (s.text) toast(`🎙 ${s.text}`, "info", 60000)
      },
      level: (v) => indicator?.level(v),
      hide: () => indicator?.hide(),
    }

    // The prompt box is an OpenTUI textarea. Remember it when talking starts
    // so dialogs or toasts that grab focus don't redirect the text.
    const focusedInput = () => {
      const r = context.renderer.currentFocusedRenderable
      return r && typeof r.insertText === "function" ? r : null
    }

    const resetSilence = () => {
      if (silenceTimer) clearTimeout(silenceTimer)
      silenceTimer = null
      if (!session) return
      const wait = heardSomething ? silenceMs : NO_SPEECH_TIMEOUT
      if (!wait || ptt.holding) return
      silenceTimer = setTimeout(() => !ptt.holding && finish(), wait)
    }

    async function deliver(text, submit) {
      const input = target && !target.isDestroyed ? target : focusedInput()
      if (input) {
        input.focus?.()
        input.insertText(text)
        if (submit) context.keymap.dispatch("prompt.submit")
        return
      }
      const copied = await copyToClipboard(text)
      toast(copied ? "Prompt box wasn't focused — copied, press ⌘V" : text, copied ? "warning" : "info", 5000)
    }

    function begin() {
      target = focusedInput()
      if (liveText) live.begin(target)
      heardSomething = false
      const language = activeLanguage()
      status.show({ phase: "listening", since: Date.now(), text: "", holding: false, lang: shortCode(language?.lang) })
      loudest = 0
      session = startListening({
        lang: language?.lang,
        mic: options.mic,
        engine: options.engine,
        allowCloud,
        hints,
        onInstalling: ({ name }) => toast(`Downloading Apple's on-device model for ${name} (one-time)…`, "info", 8000),
        onReady: ({ mic } = {}) => {
          resetSilence()
          // A mic that's connected but silent (e.g. AirPods in their case)
          // looks like "nothing happens". Say so instead.
          audioTimer = setTimeout(() => {
            if (session && !heardSomething && loudest < NO_AUDIO_LEVEL) {
              toast(
                `"${mic ?? "Microphone"}" isn't picking up any sound. Check it's on and not muted, or set the "mic" option.`,
                "warning",
                8000,
              )
            }
          }, NO_AUDIO_CHECK)
        },
        onLevel: (v) => {
          loudest = Math.max(loudest, v)
          status.level(v)
        },
        onPartial: (text) => {
          heardSomething = true
          // Words go straight into the prompt; the footer keeps the clock and
          // meter. If the prompt isn't available, the footer shows the words.
          const inPrompt = live.active && live.update(clean(text, vocab, language?.lang))
          status.show({ text: inPrompt ? "" : text, holding: ptt.holding })
          resetSilence()
        },
        onFinal: async (raw) => {
          end()
          const { text, send } = extractSend(clean(raw, vocab, language?.lang), language?.lang)
          const submit = send || options.autoSend === true
          if (!text) {
            live.clear()
            return toast("Didn't catch anything", "warning", 1500)
          }
          const committed = live.commit(text + " ")
          if (committed === true) {
            if (submit) context.keymap.dispatch("prompt.submit")
          } else if (committed === "kept") {
            toast("You edited the prompt while talking, so your edits were kept as-is", "info", 4000)
          } else {
            await deliver(text + " ", submit)
          }
        },
        onError: (err) => {
          live.clear()
          end()
          toast(err.message, "error", 6000)
        },
      })
    }

    function finish() {
      if (!session) return
      if (silenceTimer) clearTimeout(silenceTimer)
      silenceTimer = null
      status.show({ phase: "finishing", holding: false })
      session.stop()
    }

    function end() {
      session = null
      if (silenceTimer) clearTimeout(silenceTimer)
      if (audioTimer) clearTimeout(audioTimer)
      silenceTimer = audioTimer = null
      ptt.reset()
      status.hide()
    }

    function cancel() {
      live.clear()
      session?.cancel()
      end()
    }

    const ptt = createPushToTalk({ start: begin, stop: finish, isActive: () => session !== null })

    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      commands: [
        {
          id: "talk.toggle",
          title: "Talk",
          description: "Tap to start/stop, or hold while speaking",
          group: "Voice",
          bind: options.keybind ?? "ctrl+y,<leader>v",
          palette: true,
          suggested: true,
          slash: { name: "talk" },
          run: (_input, event) => {
            ptt.press(event?.repeated === true)
            if (ptt.holding) status.show({ holding: true })
          },
        },
        {
          id: "talk.language",
          title: "Talk: language",
          description: "Choose the language you speak",
          group: "Voice",
          bind: options.languageKeybind ?? false,
          palette: true,
          slash: { name: "talk:language" },
          run: () => pickLanguage(),
        },
        {
          bind: "escape",
          run: () => {
            if (!session) return false
            cancel()
          },
        },
      ],
      bindings: ["talk.toggle", "talk.language"],
    }))

    return () => {
      cancel()
      indicator?.dispose()
    }
  },
})
