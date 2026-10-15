// Spawns the native helper and turns its JSON-line output into callbacks.

import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "opencode-talk-helper")

export function startListening({
  lang,
  mic,
  engine,
  allowCloud,
  hints = [],
  env,
  onReady,
  onInstalling,
  onLevel,
  onPartial,
  onFinal,
  onError,
}) {
  const args = ["listen"]
  if (lang) args.push("--lang", lang)
  if (allowCloud) args.push("--allow-cloud")
  if (mic) args.push("--mic", mic)
  if (engine && engine !== "auto") args.push("--engine", engine)
  for (const h of hints) args.push("--hint", h)

  const child = spawn(HELPER, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: env ? { ...process.env, ...env } : process.env,
  })
  let buf = ""
  let stderr = ""
  let done = false

  const finish = (fn, value) => {
    if (done) return
    done = true
    fn?.(value)
  }

  child.stdout.on("data", (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.event === "ready") onReady?.(msg)
      else if (msg.event === "installing") onInstalling?.(msg)
      else if (msg.event === "level") onLevel?.(Number(msg.value))
      else if (msg.event === "partial") onPartial?.(msg.text)
      else if (msg.event === "final") finish(onFinal, msg.text)
      else if (msg.event === "error") finish(onError, new Error(msg.message))
    }
  })
  child.stderr.on("data", (c) => (stderr += c))
  child.on("error", (err) => finish(onError, err))
  child.on("exit", (code) => {
    if (code !== 0) finish(onError, new Error(stderr.trim() || `helper exited with code ${code}`))
    else finish(onFinal, "")
  })

  return {
    stop() {
      if (child.exitCode === null) child.stdin.write("stop\n")
    },
    cancel() {
      done = true
      child.kill("SIGTERM")
    },
  }
}

/** Runs a short helper command and returns its JSON events. */
function runHelper(args) {
  return new Promise((resolve) => {
    const child = spawn(HELPER, args, { stdio: ["ignore", "pipe", "ignore"] })
    let out = ""
    child.stdout.on("data", (c) => (out += c))
    child.on("error", () => resolve([]))
    child.on("exit", () =>
      resolve(
        out
          .split("\n")
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line)]
            } catch {
              return []
            }
          }),
      ),
    )
  })
}

/**
 * Describes languages: name, whether they're supported and on-device, and the
 * engine used. Without `langs`, uses the preferred languages from System Settings;
 * with `all`, every language this Mac can recognize.
 */
export async function listLanguages(langs = [], { all = false } = {}) {
  const args = all ? ["languages", "--all"] : ["languages", ...langs.flatMap((l) => ["--lang", l])]
  const events = await runHelper(args)
  return events
    .filter((e) => e.event === "language")
    .map((e) => ({
      lang: e.lang,
      name: e.name,
      supported: e.supported === "true",
      onDevice: e.onDevice === "true",
      engine: e.engine,
    }))
}

/**
 * On macOS 26, makes sure Apple's dictation model is installed for each
 * language (a one-time, system-managed download). Safe to call on every start.
 */
export function prepareEngine(langs = []) {
  return runHelper(["prepare", ...langs.flatMap((l) => ["--lang", l])])
}

/** Lists microphones: [{ name, default }]. */
export async function listMics() {
  const events = await runHelper(["mics"])
  return events.filter((e) => e.event === "mic").map((e) => ({ name: e.name, default: e.default === "true" }))
}
