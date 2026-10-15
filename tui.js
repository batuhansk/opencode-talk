// opencode-talk: talk instead of type in OpenCode (v2 CLI plugin).
//
// One key does everything:
//   tap  ctrl+g / ctrl+x v  start; tap again (or pause) to insert
//   hold ctrl+g             talk while holding; release to insert
//   esc                     cancel while listening
// End with "send it" to submit, or set autoSend.
//
// Options (cli.json):
//   { "package": "opencode-talk", "options": {
//       "keybind": "ctrl+g,<leader>v",    // talk keys; a single chord like ctrl+g also supports holding
//       "mic": "MacBook",                 // microphone name fragment; default: system input
//       "autoSend": false,                // submit after inserting
//       "silenceStop": 2,                 // seconds of silence before auto-stop in tap mode; 0 disables
//       "lang": "en-US",                  // default: system language
//       "vocab": { "acme db": "AcmeDB" }  // extra spoken -> written terms
//   } }

import { Plugin } from "@opencode/plugin/tui"
import { spawn } from "node:child_process"
import { buildVocab, clean, extractSend } from "./lib/clean.js"
import { startListening } from "./lib/helper.js"
import { createIndicator } from "./lib/indicator.js"
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
      heardSomething = false
      status.show({ phase: "listening", since: Date.now(), text: "", holding: false })
      loudest = 0
      session = startListening({
        lang: options.lang,
        mic: options.mic,
        hints,
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
          status.show({ text, holding: ptt.holding })
          resetSilence()
        },
        onFinal: async (raw) => {
          end()
          const { text, send } = extractSend(clean(raw, vocab))
          if (!text) return toast("Didn't catch anything", "warning", 1500)
          await deliver(text + " ", send || options.autoSend === true)
        },
        onError: (err) => {
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
          bind: options.keybind ?? "ctrl+g,<leader>v",
          palette: true,
          suggested: true,
          slash: { name: "talk" },
          run: (_input, event) => {
            ptt.press(event?.repeated === true)
            if (ptt.holding) status.show({ holding: true })
          },
        },
        {
          bind: "escape",
          run: () => {
            if (!session) return false
            cancel()
          },
        },
      ],
      bindings: ["talk.toggle"],
    }))

    return () => {
      cancel()
      indicator?.dispose()
    }
  },
})
