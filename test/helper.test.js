// Integration tests for the native helper. macOS only; needs Speech
// Recognition permission for the helper (run `bin/opencode-talk-helper check`).

import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { startListening } from "../lib/helper.js"

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "opencode-talk-helper")
function skipReason() {
  if (process.platform !== "darwin") return "macOS only"
  if (!existsSync(HELPER)) return "run npm run build first"
  // CI machines (and fresh installs) haven't granted Speech Recognition yet.
  const r = spawnSync(HELPER, ["check"], { encoding: "utf8", timeout: 20000 })
  return r.status === 0 ? false : "helper lacks Speech Recognition/Microphone permission"
}
const skip = skipReason()

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

test("transcribes a spoken clip on-device, using hints", { skip }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-talk-"))
  try {
    const clip = path.join(dir, "clip.aiff")
    execFileSync("say", ["-v", "Samantha", "-o", clip, "please rename it to use camel case"])
    const { code, out } = run("transcribe", clip, "--hint", "camelCase")
    assert.equal(code, 0)
    assert.equal(out[0].event, "final")
    assert.match(out[0].text, /rename/i)
    assert.match(out[0].text, /camelCase/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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
