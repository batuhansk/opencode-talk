// opencode-talk: talk instead of type in OpenCode (v2 CLI plugin).
//
// Press the talk key, speak, press it again: your words are cleaned up and
// inserted into the prompt. End with "send it" to submit right away.
//
// Options (cli.json):
//   { "package": "opencode-talk", "options": {
//       "keybind": "<leader>v",           // start/stop talking
//       "sendKeybind": "<leader>j",       // stop and submit
//       "lang": "en-US",                  // default: system language
//       "vocab": { "acme db": "AcmeDB" }  // extra spoken -> written terms
//   } }

import { Plugin } from "@opencode/plugin/tui"
import { spawn } from "node:child_process"
import { buildVocab, clean, extractSend } from "./lib/clean.js"
import { startListening } from "./lib/helper.js"

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
  setup(context) {
    const options = context.options ?? {}
    const vocab = buildVocab(options.vocab)
    const hints = [...vocab.hints, ...(options.hints ?? [])].slice(0, 100)
    let session = null
    let target = null
    let submitOnStop = false

    const toast = (message, variant = "info", duration = 2500) =>
      context.ui.toast.show({ title: "Talk", message, variant, duration })

    // The prompt box is an OpenTUI textarea; remember it when talking starts
    // so toasts or dialogs that grab focus don't redirect the text.
    const focusedInput = () => {
      const r = context.renderer.currentFocusedRenderable
      return r && typeof r.insertText === "function" ? r : null
    }

    async function deliver(text, submit) {
      const input = target && !target.isDestroyed ? target : focusedInput()
      if (input) {
        input.focus?.()
        input.insertText(text)
        if (submit) context.keymap.dispatch("prompt.submit")
        toast(submit ? "Sent" : "Added to prompt", "success", 1200)
        return
      }
      const copied = await copyToClipboard(text)
      toast(copied ? "Prompt box not focused — copied, press ⌘V" : text, copied ? "warning" : "info", 5000)
    }

    function start() {
      submitOnStop = false
      target = focusedInput()
      let lastShown = 0
      session = startListening({
        lang: options.lang,
        hints,
        onReady: () => toast("🎙 Listening… press again to stop", "info", 60000),
        onPartial: (text) => {
          const now = Date.now()
          if (now - lastShown < 250) return
          lastShown = now
          toast(`🎙 ${text}`, "info", 60000)
        },
        onFinal: async (raw) => {
          session = null
          const { text, send } = extractSend(clean(raw, vocab))
          if (!text) return toast("Didn't catch anything", "warning")
          await deliver(text + " ", send || submitOnStop)
        },
        onError: (err) => {
          session = null
          toast(err.message, "error", 6000)
        },
      })
    }

    function stop(submit) {
      submitOnStop = submit
      session?.stop()
      toast("Finishing…", "info", 3000)
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "talk.toggle",
          title: "Talk: start/stop",
          description: "Speak a prompt; press again to insert it",
          group: "Voice",
          bind: options.keybind ?? "<leader>v",
          palette: true,
          suggested: true,
          slash: { name: "talk" },
          run: () => (session ? stop(false) : start()),
        },
        {
          id: "talk.send",
          title: "Talk: stop and send",
          description: "Stop talking and submit the prompt",
          group: "Voice",
          bind: options.sendKeybind ?? "<leader>j",
          palette: true,
          slash: { name: "talk-send" },
          run: () => (session ? stop(true) : toast("Not listening", "warning")),
        },
        {
          id: "talk.cancel",
          title: "Talk: cancel",
          description: "Stop listening and discard",
          group: "Voice",
          palette: true,
          slash: { name: "talk-cancel" },
          run: () => {
            session?.cancel()
            session = null
            toast("Cancelled", "info", 1200)
          },
        },
      ],
      bindings: ["talk.toggle", "talk.send", "talk.cancel"],
    }))

    return () => session?.cancel()
  },
})
