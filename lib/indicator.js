// Live "🎙 listening" indicator in the prompt footer, built without JSX so the
// plugin ships as plain JS. Solid and OpenTUI are provided by OpenCode at
// runtime; if they can't be loaded, the caller falls back to toasts.

export async function createIndicator(context) {
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
    const mode = s.phase === "finishing" ? "finishing…" : s.holding ? "release to insert" : "tap again · esc cancels"
    const words = s.text ? `  ${s.text.length > 60 ? "…" + s.text.slice(-60) : s.text}` : ""
    return `● ${clock} ${mode}${words}`
  }

  const unclaim = context.ui.slot({
    prepend: "prompt.footer.status",
    render: () => {
      const el = ui.createElement("text")
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
    show(next) {
      setState((prev) => ({ since: Date.now(), text: "", holding: false, phase: "listening", ...prev, ...next }))
      if (!timer) timer = setInterval(() => setTick((n) => n + 1), 1000)
    },
    hide() {
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
