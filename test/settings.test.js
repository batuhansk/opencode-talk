import { test } from "node:test"
import assert from "node:assert/strict"
import { checkKeybind, createSettings, DEFAULTS, supportsHold } from "../lib/settings.js"

function store(initial = {}) {
  const state = { ...initial }
  return { state, update: async (fn) => fn(state) }
}

test("chat override beats cli.json, which beats the default", async () => {
  const { state, update } = store()
  const s = createSettings({ autoSend: true }, state, update)
  assert.equal(s.get("silenceStop"), DEFAULTS.silenceStop)
  assert.equal(s.source("silenceStop"), "default")
  assert.equal(s.get("autoSend"), true)
  assert.equal(s.source("autoSend"), "config")
  await s.set("autoSend", false)
  assert.equal(s.get("autoSend"), false) // false must win, not fall through
  assert.equal(s.source("autoSend"), "chat")
})

test("null is a real override (e.g. mic back to system default)", async () => {
  const { state, update } = store()
  const s = createSettings({ mic: "MacBook" }, state, update)
  await s.set("mic", null)
  assert.equal(s.get("mic"), null)
})

test("reset one or all overrides", async () => {
  const { state, update } = store()
  const s = createSettings({ engine: "legacy" }, state, update)
  await s.set("engine", "dictation")
  await s.set("liveText", false)
  await s.reset("engine")
  assert.equal(s.get("engine"), "legacy")
  assert.equal(s.get("liveText"), false)
  await s.reset()
  assert.equal(s.get("liveText"), true)
})

test("keybind validation", () => {
  assert.deepEqual(checkKeybind("ctrl+y").keys, ["ctrl+y"])
  assert.equal(checkKeybind("ctrl+y, <leader>v").ok, true)
  assert.equal(checkKeybind("ctrl+alt+f5").ok, true)
  assert.equal(checkKeybind("").ok, false)
  assert.match(checkKeybind("y").error, /would type a letter/)
  assert.match(checkKeybind("hyper+y").error, /isn't a valid key/)
  assert.match(checkKeybind("ctrl+banana").error, /isn't a valid key/)
})

test("keybind conflicts with OpenCode and terminals are reported", () => {
  const r = checkKeybind("ctrl+g,ctrl+y")
  assert.equal(r.ok, true)
  assert.deepEqual(
    r.conflicts.map((c) => c.key),
    ["ctrl+g"],
  )
  assert.equal(checkKeybind("ctrl+y").conflicts.length, 0)
})

test("hold needs a single chord", () => {
  assert.equal(supportsHold("ctrl+y,<leader>v"), true)
  assert.equal(supportsHold("<leader>v"), false)
})
