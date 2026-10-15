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
export function fakeContext({ options = {}, stored = {}, select = [], prompt = [], confirm = [] } = {}) {
  const toasts = []
  const dialogs = []
  const dispatched = []
  const state = { language: null, added: [], overrides: {}, ...stored }
  let layerFactory = null
  const answers = [...select]
  const prompts = [...prompt]
  const confirms = [...confirm]

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
        prompt: async (opts) => {
          dialogs.push({ kind: "prompt", ...opts })
          return prompts.shift()
        },
        confirm: async (opts) => {
          dialogs.push({ kind: "confirm", ...opts })
          return confirms.shift() ?? false
        },
      },
    },
    keymap: {
      // Keep the factory: OpenCode re-evaluates it when settings it reads change.
      layer: (fn) => (layerFactory = fn),
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
    command: (id) => layerFactory().commands.find((c) => c.id === id),
    get layer() {
      return layerFactory()
    },
  }
}
