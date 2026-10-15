// Live "🎙 listening" indicator in the prompt footer, built without JSX so the
// plugin ships as plain JS. Solid and OpenTUI are provided by OpenCode at
// runtime; if they can't be loaded, the caller falls back to toasts.

const BARS = "▁▂▃▄▅▆▇█"

/** A tiny 4-cell input meter, e.g. "▂▅▃▁". Older samples shift left. */
let history = [0, 0, 0, 0]
function meter() {
  return history.map((v) => BARS[Math.min(BARS.length - 1, Math.round(v * (BARS.length - 1)))]).join("")
}
export function pushLevel(level) {
  history = [...history.slice(1), level]
}

/**
 * Footer hints, built from the real key and settings, e.g.
 * "ctrl+y or pause to finish · esc cancels".
 */
export function footerHints({ key = "ctrl+y", silenceStop = 2 } = {}) {
  return {
    tap: silenceStop > 0 ? `${key} or pause to finish · esc cancels` : `${key} to finish · esc cancels`,
    hold: "release to finish · esc cancels",
  }
}

/** Human-readable first talk key: "ctrl+y", or "ctrl+x v" for "<leader>v". */
export function displayKey(keybind = "ctrl+y,<leader>v", leader = "ctrl+x") {
  const first = String(keybind).split(",")[0].trim()
  return first.replace(/^<leader>/, `${leader} `)
}

/** `hints` can be an object or a function returning one (read on every render). */
export async function createIndicator(context, hints = footerHints()) {
  let solid, ui
  try {
    solid = await import("solid-js")
    ui = await import("@opentui/solid")
  } catch {
    return null
  }

  const [state, setState] = solid.createSignal(null)
  const [tick, setTick] = solid.createSignal(0)
  let timer = null

  const label = () => {
    const s = state()
    if (!s) return ""
    tick()
    const secs = Math.floor((Date.now() - s.since) / 1000)
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`
    const h = typeof hints === "function" ? hints() : hints
    const mode = s.phase === "finishing" ? "finishing…" : s.holding ? h.hold : h.tap
    const words = s.text ? `  ${s.text.length > 60 ? "…" + s.text.slice(-60) : s.text}` : ""
    const lang = s.lang ? `${s.lang} ` : ""
    return `● ${clock} ${meter()} ${lang}${mode}${words}`
  }

  const unclaim = context.ui.slot({
    prepend: "prompt.footer.status",
    render: () => {
      const el = ui.createElement("text")
      // Take the width the hint needs instead of wrapping inside the footer row.
      ui.setProp(el, "wrapMode", "none")
      ui.setProp(el, "flexShrink", 0)
      ui.effect(() =>
        ui.setProp(
          el,
          "fg",
          state()?.phase === "finishing" ? context.theme.text.muted : context.theme.text.feedback.error.base,
        ),
      )
      ui.insert(el, label)
      return el
    },
  })

  return {
    level(value) {
      pushLevel(value)
      if (state()) setState((prev) => ({ ...prev, level: value }))
    },
    show(next) {
      setState((prev) => ({ since: Date.now(), text: "", holding: false, phase: "listening", ...prev, ...next }))
      if (!timer) timer = setInterval(() => setTick((n) => n + 1), 1000)
    },
    hide() {
      history = [0, 0, 0, 0]
      setState(null)
      if (timer) clearInterval(timer)
      timer = null
    },
    dispose() {
      this.hide()
      unclaim()
    },
  }
}
