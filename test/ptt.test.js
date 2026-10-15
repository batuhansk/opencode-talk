import { test } from "node:test"
import assert from "node:assert/strict"
import { createPushToTalk } from "../lib/ptt.js"

function harness() {
  let t = 0
  let timers = []
  const log = []
  let active = false
  const fake = {
    setTimeout: (fn, ms) => {
      const h = { at: t + ms, fn }
      timers.push(h)
      return h
    },
    clearTimeout: (h) => (timers = timers.filter((x) => x !== h)),
  }
  const ptt = createPushToTalk({
    start: () => ((active = true), log.push("start")),
    stop: () => ((active = false), log.push("stop")),
    isActive: () => active,
    now: () => t,
    timers: fake,
  })
  const advance = (ms) => {
    const end = t + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const next = timers[0]
      if (!next || next.at > end) break
      timers.shift()
      t = next.at
      next.fn()
    }
    t = end
  }
  return { ptt, log, advance }
}

test("tap to start, tap to stop", () => {
  const { ptt, log, advance } = harness()
  ptt.press()
  advance(3000)
  ptt.press()
  advance(500)
  assert.deepEqual(log, ["start", "stop"])
})

test("hold: key repeat keeps listening, release stops", () => {
  const { ptt, log, advance } = harness()
  ptt.press()
  advance(500) // OS initial repeat delay
  for (let i = 0; i < 40; i++) {
    ptt.press()
    advance(60)
  }
  assert.deepEqual(log, ["start"])
  advance(400)
  assert.deepEqual(log, ["start", "stop"])
})

test("repeated flag from kitty-style events counts as hold", () => {
  const { ptt, log, advance } = harness()
  ptt.press()
  advance(500)
  ptt.press(true)
  advance(100)
  assert.deepEqual(log, ["start"])
  advance(300)
  assert.deepEqual(log, ["start", "stop"])
})
