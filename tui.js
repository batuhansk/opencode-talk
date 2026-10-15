// opencode-talk: talk instead of type in OpenCode (v2 CLI plugin).
//
//   hold ctrl+y             talk while holding; release to finish
//   tap  ctrl+y / ctrl+x v  start; press again (or pause) to finish
//   esc                     cancel while listening
//   /talk:language          switch language      /talk:mic        pick microphone
//   /talk:keybind           change the talk key  /talk:settings   everything else
//
// cli.json options are the defaults; changes made in the chat override them and
// are remembered (reset from /talk:settings). See README for all options.

import { Plugin } from "@opencode/plugin/tui"
import { spawn } from "node:child_process"
import { appendFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { buildVocab, clean, extractSend } from "./lib/clean.js"
import { listLanguages, listMics, prepareEngine, startListening } from "./lib/helper.js"
import { createIndicator, displayKey, footerHints } from "./lib/indicator.js"
import { createLivePreview } from "./lib/live.js"
import { createPushToTalk } from "./lib/ptt.js"
import { checkKeybind, createSettings, supportsHold } from "./lib/settings.js"

const NO_SPEECH_TIMEOUT = 8000
const NO_AUDIO_CHECK = 2500
const NO_AUDIO_LEVEL = 0.05

// OPENCODE_TALK_DEBUG=1 writes a trace to ~/Library/Logs/opencode-talk.log.
const DEBUG_LOG = process.env.OPENCODE_TALK_DEBUG ? path.join(homedir(), "Library/Logs/opencode-talk.log") : null
let instances = 0
function trace(instance, message) {
  if (!DEBUG_LOG) return
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} [#${instance}] ${message}\n`)
  } catch {}
}

function copyToClipboard(text) {
  return new Promise((resolve) => {
    const p = spawn("pbcopy")
    p.on("close", (code) => resolve(code === 0))
    p.on("error", () => resolve(false))
    p.stdin.end(text)
  })
}

const onOff = (v) => (v ? "On" : "Off")

export default Plugin.define({
  id: "opencode-talk",
  async setup(context) {
    const instance = `${++instances}-${Math.random().toString(36).slice(2, 6)}`
    trace(instance, "setup")
    const options = context.options ?? {}
    const vocab = buildVocab(options.vocab)
    const hints = [...vocab.hints, ...(options.hints ?? [])].slice(0, 100)

    const toast = (message, variant = "info", duration = 2500) =>
      context.ui.toast.show({ title: "Talk", message, variant, duration })

    // Persisted state: active/added languages and chat overrides of options.
    const [state, updateState] = context.storage.store("settings", {
      initial: { language: null, added: [], overrides: {} },
    })
    const settings = createSettings(options, state, updateState)
    const allowCloud = () => settings.get("onDeviceOnly") === false

    let session = null
    let target = null
    let silenceTimer = null
    let audioTimer = null
    let heardSomething = false
    let loudest = 0
    const live = createLivePreview()

    // ── Languages ────────────────────────────────────────────────────────
    // From options, else the preferred languages in System Settings that
    // Apple can recognize. The active one, and ones added from
    // "More languages…", are remembered.
    const configured = options.languages ?? (options.lang ? [options.lang] : [])
    const base = (await listLanguages(configured).catch(() => [])).filter((l) => l.supported)
    const added = (state.added ?? []).length
      ? (await listLanguages(state.added).catch(() => [])).filter((l) => l.supported)
      : []
    let languages = [...base, ...added.filter((a) => !base.some((b) => b.lang === a.lang))]
    if (languages.length === 0) languages = [{ lang: configured[0], name: configured[0] ?? "System language" }]
    let allLanguages = null // loaded on demand; listing every language takes a few seconds
    const activeLanguage = () => languages.find((l) => l.lang === state.language) ?? languages[0]
    const shortCode = (lang) => (lang ?? "").split(/[-_]/)[0].toUpperCase()

    // On macOS 26, install Apple's dictation models in the background so the
    // first talk in each language is fast and on-device.
    prepareEngine(languages.map((l) => l.lang).filter(Boolean)).catch(() => {})

    const MORE = "\u0000more"
    const languageOption = (l) => ({
      title: l.name,
      value: l.lang,
      description: l.onDevice ? "On-device" : allowCloud() ? "Uses Apple's servers" : "Not available on-device",
      disabled: !l.onDevice && !allowCloud(),
    })

    async function chooseLanguage(lang) {
      if (!languages.some((l) => l.lang === lang)) {
        const extra = allLanguages?.find((l) => l.lang === lang)
        if (extra) languages = [...languages, extra]
      }
      await updateState((draft) => {
        draft.language = lang
        if (!configured.includes(lang) && !base.some((b) => b.lang === lang)) {
          draft.added = [...new Set([...(draft.added ?? []), lang])]
        }
      })
      prepareEngine([lang]).catch(() => {})
      toast(`Talk language: ${languages.find((l) => l.lang === lang)?.name ?? lang}`, "success", 1500)
    }

    async function removeLanguage(lang) {
      if (!(state.added ?? []).includes(lang)) {
        return toast("Only languages added from “More languages…” can be removed here", "info", 3000)
      }
      languages = languages.filter((l) => l.lang !== lang)
      await updateState((draft) => {
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

    // ── Microphone ───────────────────────────────────────────────────────
    const SYSTEM_MIC = "\u0000system"
    async function pickMic() {
      const mics = await listMics().catch(() => [])
      const current = settings.get("mic")
      const picked = await context.ui.dialog.select({
        title: "Microphone",
        current: current ?? SYSTEM_MIC,
        options: [
          { title: "System default", value: SYSTEM_MIC, description: mics.find((m) => m.default)?.name ?? "" },
          ...mics.map((m) => ({ title: m.name, value: m.name })),
        ],
      })
      if (!picked) return
      await settings.set("mic", picked === SYSTEM_MIC ? null : picked)
      toast(`Microphone: ${picked === SYSTEM_MIC ? "System default" : picked}`, "success", 1500)
    }

    // ── Talk key ─────────────────────────────────────────────────────────
    async function changeKeybind() {
      const current = settings.get("keybind")
      const input = await context.ui.dialog.prompt({
        title: "Talk key (comma-separate alternatives)",
        placeholder: current,
        value: current,
      })
      if (input === undefined || input.trim() === "") return
      const check = checkKeybind(input)
      if (!check.ok) return toast(check.error, "error", 4000)
      if (check.conflicts.length) {
        const ok = await context.ui.dialog.confirm({
          title: "That key is already used",
          message: check.conflicts.map((c) => `${c.key}: ${c.reason}`).join("\n") + "\n\nUse it anyway?",
          label: { confirm: "Use it", cancel: "Choose another" },
        })
        if (!ok) return
      }
      const keybind = check.keys.join(",")
      await settings.set("keybind", keybind)
      toast(
        supportsHold(keybind)
          ? `Talk key: ${keybind}`
          : `Talk key: ${keybind} (tap only; hold needs a single key like ctrl+y)`,
        "success",
        2500,
      )
    }

    // ── Settings menu ────────────────────────────────────────────────────
    const fromChat = (key) => (settings.source(key) === "chat" ? " (changed here)" : "")
    async function openSettings() {
      const lang = activeLanguage()
      const picked = await context.ui.dialog.select({
        title: "Talk settings",
        options: [
          { title: "Language", value: "language", description: lang?.name ?? "System language" },
          {
            title: "Microphone",
            value: "mic",
            description: (settings.get("mic") ?? "System default") + fromChat("mic"),
          },
          { title: "Talk key", value: "keybind", description: settings.get("keybind") + fromChat("keybind") },
          {
            title: "Words in the prompt while speaking",
            value: "liveText",
            description: onOff(settings.get("liveText")) + fromChat("liveText"),
          },
          {
            title: "Submit automatically",
            value: "autoSend",
            description: onOff(settings.get("autoSend")) + fromChat("autoSend"),
          },
          {
            title: "Finish after a pause",
            value: "silenceStop",
            description:
              (settings.get("silenceStop") > 0 ? `${settings.get("silenceStop")} s` : "Off") + fromChat("silenceStop"),
          },
          { title: "Speech engine", value: "engine", description: settings.get("engine") + fromChat("engine") },
          {
            title: "On-device only",
            value: "onDeviceOnly",
            description: onOff(settings.get("onDeviceOnly")) + fromChat("onDeviceOnly"),
          },
          { title: "Reset to defaults", value: "reset", description: "Undo changes made here (cli.json applies)" },
        ],
      })
      if (!picked) return
      switch (picked) {
        case "language":
          return pickLanguage()
        case "mic":
          return pickMic()
        case "keybind":
          return changeKeybind()
        case "liveText":
        case "autoSend":
        case "onDeviceOnly": {
          const value = !settings.get(picked)
          await settings.set(picked, value)
          toast(
            `${picked === "liveText" ? "Words in the prompt" : picked === "autoSend" ? "Submit automatically" : "On-device only"}: ${onOff(value)}`,
            "success",
            1500,
          )
          return openSettings()
        }
        case "silenceStop": {
          const value = await context.ui.dialog.select({
            title: "Finish after a pause of…",
            current: settings.get("silenceStop"),
            options: [1, 1.5, 2, 3, 5].map((s) => ({ title: `${s} s`, value: s })).concat([{ title: "Off", value: 0 }]),
          })
          if (value !== undefined) await settings.set("silenceStop", value)
          return openSettings()
        }
        case "engine": {
          const value = await context.ui.dialog.select({
            title: "Speech engine",
            current: settings.get("engine"),
            options: [
              { title: "auto", value: "auto", description: "Best available (recommended)" },
              { title: "dictation", value: "dictation", description: "Apple's newer engine (macOS 26)" },
              { title: "legacy", value: "legacy", description: "SFSpeechRecognizer (macOS 14+)" },
            ],
          })
          if (value) await settings.set("engine", value)
          return openSettings()
        }
        case "reset": {
          const ok = await context.ui.dialog.confirm({
            title: "Reset Talk settings?",
            message: "Changes made here are undone; your cli.json options apply again. Languages are kept.",
            label: { confirm: "Reset", cancel: "Cancel" },
          })
          if (ok) {
            await settings.reset()
            toast("Settings reset", "success", 1500)
          }
          return
        }
      }
    }

    // ── Footer and prompt ────────────────────────────────────────────────
    const footer = () =>
      footerHints({ key: displayKey(settings.get("keybind")), silenceStop: settings.get("silenceStop") })
    const indicator = await createIndicator(context, footer).catch(() => null)
    const status = {
      show(s) {
        if (indicator) return indicator.show(s)
        if (s.phase === "listening" && !s.text) toast(`🎙 Listening… ${footer().tap}`, "info", 60000)
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
      const wait = heardSomething ? settings.get("silenceStop") * 1000 : NO_SPEECH_TIMEOUT
      if (!wait || ptt.holding) return
      silenceTimer = setTimeout(() => !ptt.holding && finish(), wait)
    }

    async function deliver(text, submit) {
      trace(instance, `deliver ${JSON.stringify(text)}`)
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

    // ── Listening ────────────────────────────────────────────────────────
    function begin() {
      target = focusedInput()
      if (settings.get("liveText")) live.begin(target)
      heardSomething = false
      loudest = 0
      const language = activeLanguage()
      status.show({ phase: "listening", since: Date.now(), text: "", holding: false, lang: shortCode(language?.lang) })
      session = startListening({
        lang: language?.lang,
        mic: settings.get("mic"),
        engine: settings.get("engine"),
        allowCloud: allowCloud(),
        hints,
        onInstalling: ({ name }) => toast(`Downloading Apple's on-device model for ${name} (one-time)…`, "info", 8000),
        onReady: ({ mic, engine, lang } = {}) => {
          trace(instance, `ready mic=${mic} engine=${engine} lang=${lang}`)
          resetSilence()
          // A mic that's connected but silent (e.g. AirPods in their case)
          // looks like "nothing happens". Say so instead.
          audioTimer = setTimeout(() => {
            if (session && !heardSomething && loudest < NO_AUDIO_LEVEL) {
              toast(
                `"${mic ?? "Microphone"}" isn't picking up any sound. Check it's on and not muted, or pick another with /talk:mic.`,
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
          trace(instance, `partial ${JSON.stringify(text)} inPrompt=${inPrompt}`)
          status.show({ text: inPrompt ? "" : text, holding: ptt.holding })
          resetSilence()
        },
        onFinal: async (raw) => {
          end()
          const { text, send } = extractSend(clean(raw, vocab, language?.lang), language?.lang)
          const submit = send || settings.get("autoSend") === true
          if (!text) {
            live.clear()
            return toast("Didn't catch anything", "warning", 1500)
          }
          const committed = live.commit(text + " ")
          trace(instance, `final ${JSON.stringify(text)} commit=${committed}`)
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

    // ── Commands ─────────────────────────────────────────────────────────
    // The factory reads the talk key from settings, so changing it applies at once.
    const command = (id, title, description, slash, run, bind = false) => ({
      id,
      title,
      description,
      group: "Voice",
      bind,
      palette: true,
      slash: { name: slash },
      run,
    })
    context.keymap.layer(() => ({
      mode: "global",
      priority: 100,
      commands: [
        {
          ...command("talk.toggle", "Talk", "Tap to start/stop, or hold while speaking", "talk", (_input, event) => {
            trace(instance, `talk key (repeated=${event?.repeated === true}, active=${session !== null})`)
            ptt.press(event?.repeated === true)
            if (ptt.holding) status.show({ holding: true })
          }),
          bind: settings.get("keybind"),
          suggested: true,
        },
        command(
          "talk.language",
          "Talk: language",
          "Choose the language you speak",
          "talk:language",
          () => pickLanguage(),
          options.languageKeybind ?? false,
        ),
        command("talk.mic", "Talk: microphone", "Choose the microphone", "talk:mic", () => pickMic()),
        command("talk.keybind", "Talk: talk key", "Change the key you hold or tap to talk", "talk:keybind", () =>
          changeKeybind(),
        ),
        command(
          "talk.settings",
          "Talk: settings",
          "Language, microphone, key, auto-send and more",
          "talk:settings",
          () => openSettings(),
        ),
        {
          bind: "escape",
          run: () => {
            if (!session) return false
            cancel()
          },
        },
      ],
      bindings: ["talk.toggle", "talk.language", "talk.mic", "talk.keybind", "talk.settings"],
    }))

    return () => {
      trace(instance, "cleanup")
      cancel()
      indicator?.dispose()
    }
  },
})
