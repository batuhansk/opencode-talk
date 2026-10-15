// Spawns the native helper and turns its JSON-line output into callbacks.

import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "opencode-talk-helper")

export function startListening({ lang, hints = [], onReady, onPartial, onFinal, onError }) {
  const args = ["listen"]
  if (lang) args.push("--lang", lang)
  for (const h of hints) args.push("--hint", h)

  const child = spawn(HELPER, args, { stdio: ["pipe", "pipe", "pipe"] })
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
      if (msg.event === "ready") onReady?.()
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
