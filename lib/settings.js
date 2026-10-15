// Settings: cli.json options are the defaults; changes made in the chat
// (/talk:settings, /talk:mic, ...) override them and are remembered.

export const DEFAULTS = {
  keybind: "ctrl+y,<leader>v",
  mic: null, // null = system input
  liveText: true,
  autoSend: false,
  silenceStop: 2,
  engine: "auto",
  onDeviceOnly: true,
}

export const SETTING_KEYS = Object.keys(DEFAULTS)

/**
 * @param options  plugin options from cli.json
 * @param state    persisted store (overrides live under state.overrides)
 * @param update   async (draft => void) store updater
 */
export function createSettings(options, state, update) {
  const overrides = () => state.overrides ?? {}

  return {
    /** Effective value: chat override, then cli.json, then default. */
    get(key) {
      const o = overrides()
      if (o[key] !== undefined) return o[key]
      if (options[key] !== undefined) return options[key]
      return DEFAULTS[key]
    },

    /** Where the current value comes from. */
    source(key) {
      if (overrides()[key] !== undefined) return "chat"
      if (options[key] !== undefined) return "config"
      return "default"
    },

    async set(key, value) {
      await update((draft) => {
        draft.overrides = { ...(draft.overrides ?? {}), [key]: value }
      })
    },

    /** Drops chat overrides (all, or one key) so cli.json / defaults apply again. */
    async reset(key) {
      await update((draft) => {
        if (!key) draft.overrides = {}
        else {
          const next = { ...(draft.overrides ?? {}) }
          delete next[key]
          draft.overrides = next
        }
      })
    },
  }
}

// Single-key bindings OpenCode uses by default (see opencode.ai/v2/docs/cli/keybinds),
// plus ones terminals commonly take.
const TAKEN = {
  "ctrl+a": "OpenCode: start of line",
  "ctrl+b": "OpenCode: cursor left / background tools",
  "ctrl+c": "OpenCode: clear input / exit",
  "ctrl+d": "OpenCode: delete / exit",
  "ctrl+e": "OpenCode: end of line",
  "ctrl+f": "OpenCode: cursor right",
  "ctrl+g": "OpenCode: first message (and Warp)",
  "ctrl+i": "OpenCode: tab history (same as tab)",
  "ctrl+j": "OpenCode: new line",
  "ctrl+k": "OpenCode: delete to end of line",
  "ctrl+l": "OpenCode: clear screen",
  "ctrl+m": "Terminal: same as return",
  "ctrl+n": "OpenCode: next item",
  "ctrl+o": "OpenCode: recent sessions",
  "ctrl+p": "OpenCode: command palette",
  "ctrl+r": "OpenCode: rename session",
  "ctrl+s": "Terminal: may pause output",
  "ctrl+q": "Terminal: may resume output",
  "ctrl+t": "OpenCode: cycle model variants",
  "ctrl+u": "OpenCode: delete to start of line",
  "ctrl+v": "OpenCode: paste",
  "ctrl+w": "OpenCode: delete word",
  "ctrl+x": "OpenCode: leader key",
  "ctrl+z": "OpenCode: suspend",
  "ctrl+space": "macOS: switch input source",
  escape: "OpenCode: interrupt / cancel",
  return: "OpenCode: submit",
  tab: "OpenCode: complete",
}

const MODIFIERS = ["ctrl", "alt", "shift", "super", "meta"]

/**
 * Checks a keybind string like "ctrl+y" or "ctrl+y,<leader>v".
 * Returns { ok, keys, error, conflicts: [{ key, reason }] }.
 */
export function checkKeybind(input) {
  const keys = String(input ?? "")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
  if (keys.length === 0) return { ok: false, keys, error: "Enter a key, e.g. ctrl+y", conflicts: [] }

  for (const key of keys) {
    const leader = key.startsWith("<leader>")
    const chord = leader ? key.slice("<leader>".length) : key
    const parts = chord.split("+")
    const base = parts.pop()
    const valid =
      base &&
      parts.every((m) => MODIFIERS.includes(m)) &&
      (base.length === 1 ||
        /^(f\d{1,2}|space|return|escape|tab|up|down|left|right|home|end|pageup|pagedown)$/.test(base))
    if (!valid) return { ok: false, keys, error: `"${key}" isn't a valid key (try ctrl+y or <leader>v)`, conflicts: [] }
    if (!leader && parts.length === 0 && base.length === 1) {
      return {
        ok: false,
        keys,
        error: `"${key}" alone would type a letter; add a modifier like ctrl+${base}`,
        conflicts: [],
      }
    }
  }

  const conflicts = keys.filter((k) => TAKEN[k]).map((key) => ({ key, reason: TAKEN[key] }))
  return { ok: true, keys, error: null, conflicts }
}

/** Whether hold-to-talk works with this keybind (needs a single chord, not a leader sequence). */
export const supportsHold = (keybind) =>
  String(keybind)
    .split(",")
    .some((k) => k.trim() && !k.trim().startsWith("<leader>"))
