// Integration tests for the native helper. macOS only; needs Speech
// Recognition permission for the helper (run `bin/opencode-talk-helper check`).

import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { prepareEngine, startListening } from "../lib/helper.js"

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "opencode-talk-helper")
function skipReason() {
  if (process.platform !== "darwin") return "macOS only"
  if (!existsSync(HELPER)) return "run npm run build first"
  // CI machines (and fresh installs) haven't granted Speech Recognition yet.
  const r = spawnSync(HELPER, ["check"], { encoding: "utf8", timeout: 20000 })
  return r.status === 0 ? false : "helper lacks Speech Recognition/Microphone permission"
}
const skip = skipReason()
const hasDictation = !skip && spawnSync(HELPER, ["check"], { encoding: "utf8" }).stdout.includes('"engine":"dictation"')

function withClip(text, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-talk-"))
  try {
    const clip = path.join(dir, "clip.aiff")
    execFileSync("say", ["-v", "Samantha", "-o", clip, text])
    return fn(clip)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Streams a clip through the same live pipeline as the microphone.
function listenToClip(clip, engine) {
  return new Promise((resolve, reject) => {
    const partials = []
    let ready
    startListening({
      engine,
      onReady: (info) => (ready = info),
      onPartial: (t) => partials.push(t),
      onFinal: (text) => resolve({ ready, partials, text }),
      onError: reject,
      env: { OPENCODE_TALK_TEST_FILE: clip },
    })
  })
}

const run = (...args) => {
  const r = spawnSync(HELPER, args, { encoding: "utf8", timeout: 60000 })
  return {
    code: r.status,
    out: r.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l)),
  }
}

const helperProcesses = () => {
  try {
    return execFileSync("pgrep", ["-f", `${HELPER} listen`], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
  } catch {
    return []
  }
}

test("rejects unknown commands and missing arguments", { skip }, () => {
  assert.deepEqual(run("bogus"), { code: 1, out: [{ event: "error", message: "Unknown command: bogus" }] })
  assert.equal(run("transcribe").out[0].message, "Usage: transcribe <audio-file>")
})

test("lists microphones and rejects unknown ones", { skip }, () => {
  const { code, out } = run("mics")
  assert.equal(code, 0)
  assert.ok(out.length > 0 && out.every((m) => m.event === "mic" && m.name))
  assert.equal(out.filter((m) => m.default === "true").length, 1)
  const bad = run("listen", "--mic", "no-such-mic-xyz")
  assert.equal(bad.code, 1)
  assert.match(bad.out[0].message, /No microphone matching/)
})

test("transcribes a spoken clip on-device (legacy engine, with hints)", { skip }, () => {
  withClip("please rename it to use camel case", (clip) => {
    const { code, out } = run("transcribe", clip, "--engine", "legacy", "--hint", "camelCase")
    assert.equal(code, 0)
    assert.equal(out[0].engine, "legacy")
    assert.match(out[0].text, /rename/i)
    assert.match(out[0].text, /camelCase/)
  })
})

test(
  "transcribes a spoken clip with the macOS 26 dictation engine",
  { skip: skip || (!hasDictation && "needs macOS 26 dictation model") },
  () => {
    withClip("please rename it to use camel case", (clip) => {
      const { code, out } = run("transcribe", clip, "--engine", "dictation")
      assert.equal(code, 0)
      assert.equal(out[0].engine, "dictation")
      assert.match(out[0].text, /rename it to use camel ?case/i)
    })
  },
)

for (const engine of ["legacy", "dictation"]) {
  const engineSkip = skip || (engine === "dictation" && !hasDictation && "needs macOS 26 dictation model")
  test(
    `live pipeline streams partials then the final text (${engine})`,
    { skip: engineSkip, timeout: 30000 },
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "opencode-talk-"))
      try {
        const clip = path.join(dir, "clip.aiff")
        execFileSync("say", ["-v", "Samantha", "-o", clip, "run the tests then fix anything that fails"])
        const { ready, partials, text } = await listenToClip(clip, engine)
        assert.equal(ready.engine, engine)
        assert.ok(partials.length >= 3, `expected several partials, got ${partials.length}`)
        assert.match(text, /run the tests?/i)
        assert.match(text, /fails/i)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
}

test("prepare reports the engine that will be used", { skip }, async () => {
  const engine = await prepareEngine()
  assert.ok(["dictation", "legacy"].includes(engine))
  assert.equal(engine === "dictation", hasDictation)
})

test("stop returns a final result and leaves no processes", { skip }, async () => {
  const events = []
  await new Promise((resolve, reject) => {
    const s = startListening({
      onReady: (info) => (events.push("ready"), assert.ok(info.mic), setTimeout(() => s.stop(), 800)),
      onLevel: (v) => assert.ok(v >= 0 && v <= 1),
      onFinal: (text) => (events.push(typeof text), resolve()),
      onError: reject,
    })
  })
  assert.deepEqual(events, ["ready", "string"])
  await new Promise((r) => setTimeout(r, 300))
  assert.deepEqual(helperProcesses(), [])
})

test("cancel kills the helper, including its relaunched child", { skip }, async () => {
  await new Promise((resolve, reject) => {
    const s = startListening({ onReady: () => (s.cancel(), resolve()), onError: reject })
  })
  await new Promise((r) => setTimeout(r, 1000))
  assert.deepEqual(helperProcesses(), [])
})
