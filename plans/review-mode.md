# Show what changed

## Problem

The changes list behind the corner button shows each change as a snippet with the old words crossed out and the new ones marked (`snippet` in `static/editor.js`). On the page itself, only the new words are tinted, briefly. After a long stretch of the agent working, for example while the user was away, there's no way to read the whole document with all the changes in place, the way Word's "Show markup" view does. The list shows only fragments, and the page shows only the result.

Putting the old words into the normal editable page is unsafe: the page saves its own HTML, so extra text could end up in the file, lines would rewrap and jump, and typing among deleted text has no sensible meaning. This plan avoids all three by making it a separate, **read-only** view the user turns on and off. For a lighter answer to "what did this word replace?", see [Old words on hover](old-words-on-hover.md), which is worth doing first.

## Change

1. **A toggle.** Add "Show what changed" to the header of the changes panel (`renderChanges`), as a switch. Turning it on enters review mode; turning it off, pressing Escape, or clicking "Done" in a small bar at the top of the page leaves it. Persist the state across reloads the same way the open panel is (`changes` in the state `reload()` saves), so agent edits arriving during review don't throw the user out.
2. **Entering review mode.**
   - Save anything pending first (`pending()` / `save`), as `reload()` does.
   - Make every block non-editable (`contentEditable = "false"`), hide the toolbar, grips and + buttons, and ignore input, drag and keyboard handlers while the mode is on (one `reviewing` flag checked at the top of each).
   - Remember each block's `innerHTML` before changing it, so leaving restores the exact DOM. Leaving can also simply reload the page, which is simpler and just as correct; prefer that unless it feels slow.
   - Show a slim bar at the top: "Showing what changed since inplace started. Editing is paused." with "Only the agent's changes" (a checkbox, on by default) and "Done".
3. **What to show.** Use the server's history (`GET /__inplace/history`), not the page's own reload snapshot, so the view covers the whole session:
   - For each block, combine all entries in scope (agent only, or everyone) into one change: the earliest `before` and the current text. `History.add` already folds changes within one entry; do the same across entries here, on the page.
   - **Edited blocks:** diff the earliest `before` against the block's current `textContent` with `diffWords` (whitespace-insensitive already). Wrap added text in `<ins data-inplace-ui>` and insert removed text as `<del data-inplace-ui>` at the right offsets, splitting text nodes with the same offset-to-node walk `changedRanges` uses. Inline formatting inside the block stays as it is, since only text nodes are split.
   - **New blocks:** tint the whole block, like the current highlight.
   - **Removed blocks:** show the old text as a struck-through ghost paragraph where it was. The history doesn't record positions yet: extend `BlockChange` in `src/history.ts` with the id of the previous sibling block when a block is removed (or moved), and insert the ghost after that block, or at the start of the parent if there's none. If that sibling is gone too, collect such ghosts in a short "Also removed" note in the top bar instead.
   - **Moved blocks:** a small "Moved here" label in the margin, no text marks.
   - **Tag changes** (`fromTag`): a small "Was a paragraph" label in the margin.
   Reuse the colours of the changes list (`del` in red, `ins` in lavender) so the two read the same.
4. **Printing.** Printing while review mode is on prints the marks, which is useful for a paper review. The existing print rules hide inplace's own UI; keep the `ins`/`del` marks and the ghosts visible in print, but hide the top bar.
5. **Agent edits during review.** The page reloads as usual and comes back in review mode with the new history, so changes accumulate in the view. Skip the arrival highlights and sparkles while in review mode, since everything is already marked.
6. Mention review mode in the README next to the changes list.

## Open questions

- **Scope.** "Since inplace started" is what the history holds. Changes from before the server started, or from before a restart, aren't covered. That's probably fine for a first version. A later version could let the user pick "since I last looked" using the `seenChanges` marker the corner dot uses.
- **Long documents.** Diffing every changed block at once is fine for typical documents (the token LCS in `diffWords` falls back to a single replacement for very long blocks). Check it on a document with a few hundred changed paragraphs before shipping.

## Tests

- e2e: the agent edits two paragraphs, adds a row and removes a list item. Turning the mode on shows `del`/`ins` in the right places, the row tinted and a ghost for the removed item. Typing does nothing. Turning it off restores the page, and the file is byte-for-byte what the agent wrote, with no `ins`, `del` or ghosts in it.
- e2e: with the mode on, the agent edits the file again; after the reload the mode is still on and the new change is marked too.
- e2e: the "Only the agent's changes" checkbox hides the user's own edits.
- Unit test for recording the previous sibling of removed and moved blocks in `diffBlocks`.

## Done when

The user can switch the page into a read-only view that shows every change since inplace started inline, crossed out and marked, switch back without anything reaching the file, and the suites pass.
