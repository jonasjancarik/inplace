# Old words on hover

## Problem

When the agent changes a few words in a paragraph, the page tints only the new words (`tintWords` in `static/editor.js`, using the CSS Custom Highlight API). The user sees *where* something changed but not *what it replaced*. "October" is tinted, but was it "autumn", "September" or nothing? Today the answer is only in the changes list behind the corner button, which means opening it and finding the right entry.

Showing the old words inline, crossed out, would answer this directly, but it means putting text into the editable page that isn't in the document. That risks it being saved, makes lines rewrap and jump, and puts the caret among text that doesn't exist. A tooltip gives the same answer without touching the page. The full inline view is a separate, optional mode: see [Show what changed](review-mode.md).

## Change

1. **Keep the old words with each range.** `changedRanges(el, before)` already walks the runs from `diffWords`, so it knows, for each stretch of added words, which words it replaced (`run.gone`). Return `{ range, gone }` pairs instead of bare ranges, and store them in `wordChanges` next to the ranges. A pure insertion has an empty `gone`.
2. **Find the word under the pointer.** Highlights aren't elements, so they get no mouse events. On `pointermove` over a block that has an entry in `wordChanges` (throttled to one check per animation frame), take the text position under the pointer with `document.caretPositionFromPoint` (or `caretRangeFromPoint` in Safari) and look for the stored range that contains it (`range.isPointInRange`).
3. **Show a small tooltip** above the range's first client rect, positioned `fixed` and marked `data-inplace-ui` so it's never inside an editable block and never saved:
   - replaced words: "Was: ~~A structural~~", with the old words styled like `del` in the changes list
   - added words: "Added by your agent"
   - Wrap long old text at about 160 characters with an ellipsis, as `clipText` does.
   Hide it on `pointerleave`, scroll, typing in the block, or when the pointer moves off the range. On touch, a tap on a tinted word shows it until the next tap elsewhere, without stopping the tap from placing the caret.
4. **Blocks tinted as a whole.** When a block was mostly rewritten (`changedRanges` returned null) and the page has the text from before, the tooltip on the block shows "Was: …" with the first 160 characters of the old text. New blocks show nothing.
5. **After the tint fades.** `fadeWords` deletes the highlight when the fade ends. Keep the ranges and old words in `wordChanges` until the next reload so hovering still works, but show no mark once the tint is gone. Decide while building this whether a faint dotted underline should remain so the user knows there's something to hover. Start without one and try it on the example document.
6. **Changes list replay.** `replay(el, before)` already re-tints the words from the history's before text. The same pairs make the tooltip work there too, with no extra code beyond step 1.
7. Keyboard users have no hover. The changes list already shows the same information, so don't add a keyboard path to the tooltip. Make sure the tooltip has `role="tooltip"` and doesn't take focus.

## Tests

- Unit-style check in the page (e2e `evaluate`): `changedRanges` returns the right `gone` text for a replacement, an insertion and two separate changes in one paragraph.
- e2e: the agent changes "autumn" to "October"; hovering "October" shows "Was: autumn"; moving away hides it; the file is byte-for-byte unchanged afterwards (the tooltip never got saved).
- e2e: hovering still works after the tint has faded, and stops after the next reload.

## Done when

Hovering or tapping a word the agent changed shows what it replaced, nothing extra is ever written to the file, and the suites pass.
