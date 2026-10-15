// Shows words in the prompt box while you talk, then swaps in the final text.
//
// OpenCode has no API for editing the prompt, so this edits the focused
// textarea directly: it keeps track of what it inserted and replaces only the
// part that changed. If you type or move the cursor while talking, it stops
// touching the prompt so it never overwrites your edits.

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const graphemes = (s) => Array.from(segmenter.segment(s), (g) => g.segment)

export function createLivePreview() {
  let input = null
  let shown = [] // graphemes currently inserted by us
  let offsets = [] // cursor offset after each shown grapheme
  let start = 0 // cursor offset where the preview begins
  let expectedText = ""
  let expectedCursor = 0
  let active = false

  const snapshot = () => {
    expectedText = input.plainText
    expectedCursor = input.cursorOffset
  }

  // True if the prompt still looks exactly as we left it.
  const untouched = () =>
    active && input && !input.isDestroyed && input.plainText === expectedText && input.cursorOffset === expectedCursor

  // Cursor offsets are recorded rather than computed, so this works no matter
  // how the textarea counts characters (code points, graphemes, ...).
  function replaceWith(text) {
    const next = graphemes(text)
    let common = 0
    while (common < shown.length && common < next.length && shown[common] === next[common]) common++
    const target = common === 0 ? start : offsets[common - 1]
    let guard = shown.length * 4 + 8
    while (input.cursorOffset > target && guard-- > 0) input.deleteCharBackward()
    shown = shown.slice(0, common)
    offsets = offsets.slice(0, common)
    for (const g of next.slice(common)) {
      input.insertText(g)
      shown.push(g)
      offsets.push(input.cursorOffset)
    }
    snapshot()
  }

  return {
    /** Starts a preview in this textarea (or does nothing if there's none). */
    begin(textarea) {
      input = textarea && typeof textarea.insertText === "function" ? textarea : null
      shown = []
      offsets = []
      active = input !== null
      if (active) {
        start = input.cursorOffset
        snapshot()
      }
      return active
    },

    /** Whether live text is currently being shown in the prompt. */
    get active() {
      return active
    },

    /** Shows the latest partial text. Returns false once the user has taken over. */
    update(text) {
      if (!untouched()) {
        active = false
        return false
      }
      replaceWith(text)
      return true
    },

    /**
     * Replaces the preview with the final text. Returns true if done; false
     * means the caller should insert the text itself (no preview, or the user
     * edited the prompt meanwhile).
     */
    commit(text) {
      if (!untouched()) {
        const hadPreview = shown.length > 0
        active = false
        return hadPreview ? "kept" : false
      }
      replaceWith(text)
      active = false
      return true
    },

    /** Removes the preview text (on cancel). */
    clear() {
      if (untouched()) replaceWith("")
      active = false
    },
  }
}
