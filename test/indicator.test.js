import { test } from "node:test"
import assert from "node:assert/strict"
import { displayKey, footerHints } from "../lib/indicator.js"

test("footer names the real key and the pause-to-finish behavior", () => {
  assert.equal(footerHints({ key: displayKey() }).tap, "ctrl+y or pause to finish · esc cancels")
  assert.equal(footerHints({ key: displayKey("<leader>v") }).tap, "ctrl+x v or pause to finish · esc cancels")
})

test("without auto-stop, the footer doesn't promise it", () => {
  assert.equal(footerHints({ key: "ctrl+y", silenceStop: 0 }).tap, "ctrl+y to finish · esc cancels")
})

test("hold mode says release finishes (words are already in the prompt)", () => {
  assert.equal(footerHints().hold, "release to finish · esc cancels")
})
