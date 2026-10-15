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

test("registers the talk and settings commands", { skip }, async () => {
  const { command, cleanup } = await setup({ options: { languages: ["en-US"] } })
  assert.equal(command("talk.toggle").slash.name, "talk")
  assert.equal(command("talk.toggle").bind, "ctrl+y,<leader>v")
  for (const [id, slash] of [
    ["talk.language", "talk:language"],
    ["talk.mic", "talk:mic"],
    ["talk.keybind", "talk:keybind"],
    ["talk.settings", "talk:settings"],
  ]) {
    assert.equal(command(id).slash.name, slash)
    assert.equal(command(id).bind, false) // no default key
  }
  cleanup()
})

test("/talk:keybind changes the talk key immediately and remembers it", { skip }, async () => {
  const { command, state, toasts, cleanup } = await setup({
    options: { languages: ["en-US"] },
    prompt: ["Ctrl+K, <leader>v"],
    confirm: [true],
  })
  await command("talk.keybind").run()
  assert.equal(command("talk.toggle").bind, "ctrl+k,<leader>v")
  assert.equal(state.overrides.keybind, "ctrl+k,<leader>v")
  assert.match(toasts.at(-1).message, /ctrl\+k/)
  cleanup()
})

test("/talk:keybind warns about keys OpenCode uses, and can be declined", { skip }, async () => {
  const { command, dialogs, state, cleanup } = await setup({
    options: { languages: ["en-US"] },
    prompt: ["ctrl+g"],
    confirm: [false],
  })
  await command("talk.keybind").run()
  const confirm = dialogs.find((d) => d.kind === "confirm")
  assert.match(confirm.message, /ctrl\+g/)
  assert.equal(state.overrides.keybind, undefined)
  assert.equal(command("talk.toggle").bind, "ctrl+y,<leader>v")
  cleanup()
})

test("/talk:keybind rejects invalid keys", { skip }, async () => {
  const { command, toasts, state, cleanup } = await setup({ options: { languages: ["en-US"] }, prompt: ["y"] })
  await command("talk.keybind").run()
  assert.equal(state.overrides.keybind, undefined)
  assert.equal(toasts.at(-1).variant, "error")
  cleanup()
})

test("/talk:mic lists microphones and remembers the choice", { skip }, async () => {
  const { command, dialogs, state, cleanup } = await setup({
    options: { languages: ["en-US"] },
    select: [(opts) => opts.options[1]?.value], // first real microphone
  })
  await command("talk.mic").run()
  assert.equal(dialogs[0].options[0].title, "System default")
  assert.ok(dialogs[0].options.length >= 2, "expected at least one microphone")
  assert.equal(state.overrides.mic, dialogs[0].options[1].value)
  cleanup()
})

test("/talk:settings toggles options over cli.json and can reset", { skip }, async () => {
  const { command, dialogs, state, cleanup } = await setup({
    options: { languages: ["en-US"], autoSend: true },
    select: [
      "autoSend",
      (opts) => (
        assert.match(opts.options.find((o) => o.value === "autoSend").description, /Off \(changed here\)/),
        "reset"
      ),
    ],
    confirm: [true],
  })
  assert.match(command("talk.settings").description, /auto-send/)
  await command("talk.settings").run()
  assert.equal(state.overrides.autoSend, undefined) // reset undid the change
  assert.equal(dialogs.filter((d) => d.title === "Talk settings").length, 2)
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
  // "On-device" depends on Apple's installed speech assets, so CI may differ.
  assert.match(dialogs[0].options[0].description, /On-device|Not available on-device/)
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
