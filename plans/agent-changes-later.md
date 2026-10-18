# Reviewing the agent's changes: what's left

Keep and Undo for each block the agent changed are done (see "Reviewing what the agent changed" in the README, `src/pending.ts` and `src/editor/to-review.ts`). The pending changes are kept beside the document as the side data `"pending"`, never in the HTML. This plan collects what was left open, to be picked up on its own.

## Print or export without the changes still to review

The agent's edits are always applied, and the user can undo them afterwards. Someone reviewing a large rewrite may still want a clean copy of the document as it was before, for instance to print it or send it on while they decide. Add an option, in the list of changes, to print or save the document with every pending change undone, without writing that to the file. `reverseChange()` in `src/pending.ts` already works on a string, so applying it to each pending change on a copy of the file is most of the work; changes that can't be undone (too large, or edited since in the same words) should be named so the user knows the copy isn't fully clean.

## Keep and Undo from the keyboard, beside the block

Keep and Undo beside a block appear on hover and when the block is focused, but they sit at the end of the page, so Tab from the block doesn't reach them. The list of changes is fully keyboard-reachable, so nothing is out of reach, but a shortcut while the caret is in a block with a pending change (or putting the buttons right after the block in the tab order) would be quicker.

## Open questions

- Should the user's own changes be reviewable too, for a document two people edit? [Who wrote what](../README.md) shows who changed what, and a person can undo their own typing. Revisit with accounts in inplace cloud.
- Should a block the user has edited after the agent count as kept? For now it stays pending, so the user can still undo just the agent's words. See how that feels in use.
