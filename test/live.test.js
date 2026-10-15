import { test } from "node:test"
import assert from "node:assert/strict"
import { createLivePreview } from "../lib/live.js"

// Minimal stand-in for OpenTUI's textarea: text plus a cursor. `unit` picks
// how it counts characters, since the real one's counting isn't documented.
const units = {
  utf16: (s) => s.split(""),
  codepoint: (s) => Array.from(s),
  grapheme: (s) => Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s), (g) => g.segment),
}

function fakeTextarea(text = "", cursor = text.length, unit = "codepoint") {
  const t = {
    text,
    cursor,
    edits: 0,
    deletes: 0,
    get plainText() {
      return t.text
    },
    get cursorOffset() {
      return t.cursor
    },
    insertText(s) {
      t.text = t.text.slice(0, t.cursor) + s + t.text.slice(t.cursor)
      t.cursor += s.length
      t.edits++
    },
    deleteCharBackward() {
      const chars = units[unit](t.text.slice(0, t.cursor))
      const removed = chars.pop() ?? ""
      t.text = chars.join("") + t.text.slice(t.cursor)
      t.cursor -= removed.length
      t.edits++
      t.deletes++
    },
  }
  return t
}

test("streams partials into the prompt and commits the final text", () => {
  const box = fakeTextarea("Hi ")
  const live = createLivePreview()
  assert.equal(live.begin(box), true)
  live.update("add a")
  live.update("add a null")
  live.update("add an L check")
  assert.equal(box.text, "Hi add an L check")
  assert.equal(live.commit("Add a null check "), true)
  assert.equal(box.text, "Hi Add a null check ")
})

test("only rewrites the part that changed", () => {
  const box = fakeTextarea()
  const live = createLivePreview()
  live.begin(box)
  live.update("run the tests")
  live.update("run the tests then")
  assert.equal(box.deletes, 0) // appended, nothing rewritten
  live.update("run the test")
  assert.equal(box.deletes, 6) // only " then" and the "s" removed
  assert.equal(box.text, "run the test")
})

test("inserts in the middle of existing text at the cursor", () => {
  const box = fakeTextarea("Fix  please", 4)
  const live = createLivePreview()
  live.begin(box)
  live.update("the bug")
  live.commit("the parser")
  assert.equal(box.text, "Fix the parser please")
})

test("stops touching the prompt once the user types", () => {
  const box = fakeTextarea()
  const live = createLivePreview()
  live.begin(box)
  live.update("hello wor")
  box.insertText("!") // user types
  assert.equal(live.update("hello world"), false)
  assert.equal(live.commit("Hello world "), "kept")
  assert.equal(box.text, "hello wor!")
})

test("stops if the user moves the cursor", () => {
  const box = fakeTextarea()
  const live = createLivePreview()
  live.begin(box)
  live.update("hello")
  box.cursor = 0
  assert.equal(live.update("hello there"), false)
})

test("cancel removes the preview", () => {
  const box = fakeTextarea("Keep ")
  const live = createLivePreview()
  live.begin(box)
  live.update("never mind")
  live.clear()
  assert.equal(box.text, "Keep ")
})

for (const unit of Object.keys(units)) {
  test(`handles emoji and accents whatever the textarea counts (${unit})`, () => {
    const box = fakeTextarea("", 0, unit)
    const live = createLivePreview()
    live.begin(box)
    live.update("café 👍🏽 ok")
    live.update("café 👍🏽")
    live.commit("Café 👍🏽!")
    assert.equal(box.text, "Café 👍🏽!")
  })
}

test("without a textarea, the caller inserts the text", () => {
  const live = createLivePreview()
  assert.equal(live.begin(null), false)
  assert.equal(live.update("x"), false)
  assert.equal(live.commit("x"), false)
})
