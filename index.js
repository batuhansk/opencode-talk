// opencode-talk: talk instead of type in OpenCode.
//
// Press the talk key, speak, press it again: your words are cleaned up and
// added to the prompt. End with "send it" to submit right away.
//
// Options (tui.json):
//   ["opencode-talk", {
//     "keybind": "<leader>v",           // toggle talk
//     "sendKeybind": "<leader>j",       // stop and submit
//     "lang": "en-US",                  // default: system language
//     "vocab": { "acme db": "AcmeDB" }  // extra spoken -> written terms
//   }]

import { buildVocab, clean, extractSend } from "./lib/clean.js";
import { startListening } from "./lib/helper.js";

export default {
  id: "opencode-talk",
  tui: async (api, options = {}) => {
    const client = api.client;
    const vocab = buildVocab(options.vocab);
    const hints = [...vocab.hints, ...(options.hints ?? [])].slice(0, 100);
    let session = null;
    let submitOnStop = false;

    const toast = (message, variant = "info", duration = 2500) =>
      api.ui.toast({ message, variant, duration });

    async function insert(text, submit) {
      let res = await client.tui.appendPrompt({ body: { text } });
      if (res?.error?.data?.message === "Expected object, got undefined") {
        res = await client.tui.appendPrompt({ text });
      }
      if (res?.error) throw new Error(res.error.data?.message || res.error.name);
      if (submit) await client.tui.submitPrompt();
    }

    function start() {
      submitOnStop = false;
      let lastShown = 0;
      session = startListening({
        lang: options.lang,
        hints,
        onReady: () => toast("🎙 Listening… press again to stop", "info", 60000),
        onPartial: (text) => {
          const now = Date.now();
          if (now - lastShown < 250) return;
          lastShown = now;
          toast(`🎙 ${text}`, "info", 60000);
        },
        onFinal: async (raw) => {
          session = null;
          const { text, send } = extractSend(clean(raw, vocab));
          if (!text) return toast("Didn't catch anything", "warning");
          try {
            await insert(text + " ", send || submitOnStop);
            toast(send || submitOnStop ? "Sent" : "Added to prompt", "success", 1200);
          } catch (err) {
            toast(`Could not add text: ${err.message}`, "error", 5000);
          }
        },
        onError: (err) => {
          session = null;
          toast(err.message, "error", 6000);
        },
      });
    }

    function stop(submit) {
      submitOnStop = submit;
      session?.stop();
      toast("Finishing…", "info", 3000);
    }

    api.command.register(() => [
      {
        title: "Talk: start/stop",
        value: "talk.toggle",
        description: "Speak a prompt; press again to add it to the input",
        category: "Voice",
        keybind: options.keybind ?? "<leader>v",
        slash: { name: "talk" },
        onSelect: () => (session ? stop(false) : start()),
      },
      {
        title: "Talk: stop and send",
        value: "talk.send",
        description: "Stop talking and submit the prompt",
        category: "Voice",
        keybind: options.sendKeybind ?? "<leader>j",
        slash: { name: "talk-send" },
        onSelect: () => (session ? stop(true) : toast("Not listening", "warning")),
      },
      {
        title: "Talk: cancel",
        value: "talk.cancel",
        description: "Stop listening and discard",
        category: "Voice",
        slash: { name: "talk-cancel" },
        onSelect: () => {
          session?.cancel();
          session = null;
          toast("Cancelled", "info", 1200);
        },
      },
    ]);
  },
};
