// Loads the real plugin against a fake OpenCode and drives it like a user.
import { fakeContext } from "./support/opencode-stub.js"
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const skip =
  process.platform !== "darwin"
    ? "macOS only"
    : !existsSync(path.join(root, "bin/opencode-talk-helper"))
      ? "run npm run build first"
      : false

const { default: plugin } = await import("../tui.js")

async function setup(opts) {
  const fake = fakeContext(opts)
  const cleanup = await plugin.setup(fake.context)
  return { ...fake, cleanup }
}

test("registers the talk and language commands", { skip }, async () => {
  const { command, cleanup } = await setup({ options: { languages: ["en-US"] } })
  assert.equal(command("talk.toggle").slash.name, "talk")
  assert.equal(command("talk.toggle").bind, "ctrl+y,<leader>v")
  assert.equal(command("talk.language").slash.name, "talk:language")
  assert.equal(command("talk.language").bind, false) // no default key
  cleanup()
})

test("language picker lists configured languages and remembers the choice", { skip }, async () => {
  const { command, dialogs, state, toasts, cleanup } = await setup({
    options: { languages: ["en-US", "fr-FR"] },
    select: ["fr-FR"],
  })
  await command("talk.language").run()
  const titles = dialogs[0].options.map((o) => o.title)
  assert.deepEqual(titles, ["English (United States)", "French (France)", "More languages…"])
  assert.equal(dialogs[0].options[0].description, "On-device")
  assert.equal(state.language, "fr-FR")
  assert.equal(state.added.length, 0) // configured languages aren't "added"
  assert.match(toasts.at(-1).message, /French/)
  cleanup()
})

test("“More languages…” lists every language and remembers an added one", { skip, timeout: 30000 }, async () => {
  const { command, dialogs, state, cleanup } = await setup({
    options: { languages: ["en-US"] },
    select: ["\u0000more", "ja-JP"],
  })
  await command("talk.language").run()
  const all = dialogs[1].options
  assert.ok(all.length > 30, `expected many languages, got ${all.length}`)
  assert.ok(all.some((o) => o.value === "ja-JP"))
  assert.equal(state.language, "ja-JP")
  assert.deepEqual(state.added, ["ja-JP"])
  cleanup()
})

test("added languages come back after a restart and can be removed", { skip }, async () => {
  const { command, dialogs, state, cleanup } = await setup({
    options: { languages: ["en-US"] },
    stored: { language: "ja-JP", added: ["ja-JP"] },
    select: [
      async (opts) => {
        assert.equal(opts.current, "ja-JP")
        assert.ok(opts.options.some((o) => o.value === "ja-JP"))
        await opts.actions[0].onTrigger("ja-JP") // "Remove"
        return undefined
      },
    ],
  })
  await command("talk.language").run()
  assert.deepEqual(state.added, [])
  assert.equal(state.language, null)
  assert.equal(dialogs.length, 1)
  cleanup()
})

test("without a languages option, uses the System Settings languages", { skip }, async () => {
  const { command, dialogs, cleanup } = await setup({ select: [undefined] })
  await command("talk.language").run()
  assert.ok(dialogs[0].options.length >= 2) // at least one language + "More languages…"
  cleanup()
})
