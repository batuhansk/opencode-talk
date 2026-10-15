// Push-to-talk detection without key-release events.
//
// Terminals send repeated key presses while a key is held. OpenCode doesn't
// enable kitty release events, so we infer "held" from that repeat stream:
//   - a lone press toggles (tap to start, tap to stop)
//   - a steady stream of presses means the key is held; when the stream
//     stops, the key was released and we stop.

export function createPushToTalk({ start, stop, isActive, repeatGap = 150, releaseGap = 300, now = Date.now, timers = globalThis }) {
  let lastPress = 0
  let holding = false
  let pendingStop = null
  let releaseTimer = null

  const clear = () => {
    if (pendingStop) timers.clearTimeout(pendingStop)
    if (releaseTimer) timers.clearTimeout(releaseTimer)
    pendingStop = releaseTimer = null
  }

  const armRelease = () => {
    if (releaseTimer) timers.clearTimeout(releaseTimer)
    releaseTimer = timers.setTimeout(() => {
      releaseTimer = null
      holding = false
      if (isActive()) stop()
    }, releaseGap)
  }

  return {
    get holding() {
      return holding
    },
    press(repeated = false) {
      const t = now()
      const gap = t - lastPress
      lastPress = t

      if (!isActive()) {
        clear()
        holding = false
        start()
        return
      }

      if (holding || repeated || gap < repeatGap) {
        // Part of a held key's repeat stream.
        if (pendingStop) timers.clearTimeout(pendingStop)
        pendingStop = null
        holding = true
        armRelease()
        return
      }

      // Could be a second tap, or the first auto-repeat after the OS repeat
      // delay. Wait briefly: more repeats mean the key is held.
      if (pendingStop) timers.clearTimeout(pendingStop)
      pendingStop = timers.setTimeout(() => {
        pendingStop = null
        if (isActive() && !holding) stop()
      }, repeatGap)
    },
    reset() {
      clear()
      holding = false
    },
  }
}
