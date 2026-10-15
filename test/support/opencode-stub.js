// Stand-ins for the packages OpenCode provides to plugins at runtime, so the
// whole plugin can be loaded and exercised in tests.
import { registerHooks } from "node:module"

const STUB = "data:text/javascript,export const Plugin = { define: (p) => p }"

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@opencode/plugin/tui") return { url: STUB, shortCircuit: true }
    return next(specifier, context)
  },
})

/** A fake plugin context that records what the plugin does. */
export function fakeContext({ options = {}, stored = {}, select = [] } = {}) {
  const toasts = []
  const dialogs = []
  const dispatched = []
  const state = { language: null, added: [], ...stored }
  let layer = null
  const answers = [...select]

  const context = {
    options,
    renderer: { currentFocusedRenderable: null },
    theme: { text: { muted: "#888", feedback: { error: { base: "#f00" } } } },
    ui: {
      toast: { show: (t) => toasts.push(t) },
      slot: () => () => {},
      dialog: {
        clear: () => {},
        select: async (opts) => {
          dialogs.push(opts)
          const answer = answers.shift()
          return typeof answer === "function" ? answer(opts) : answer
        },
      },
    },
    keymap: {
      layer: (fn) => (layer = fn()),
      dispatch: (id) => dispatched.push(id),
    },
    storage: {
      store: () => [
        state,
        async (fn) => {
          fn(state)
        },
      ],
    },
  }
  return {
    context,
    state,
    toasts,
    dialogs,
    dispatched,
    command: (id) => layer.commands.find((c) => c.id === id),
    get layer() {
      return layer
    },
  }
}
