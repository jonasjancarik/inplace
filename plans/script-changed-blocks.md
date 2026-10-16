# Blocks changed by the page's scripts

## Problem

Some documents contain scripts that fill in or change text when the page loads: a total computed from table rows, today's date, a number formatted for the reader's locale, text rendered by a chart or diagram library. inplace serves the file and the scripts run as usual.

`makeEditable` in `static/editor.js` records each editable block's `innerHTML` in `saved` *after* those scripts have run, and uses it as the "old" value when it saves. If a script changed a block, that "old" value doesn't match the file, and one of two things happens when the user types in the block:

- the server's three-way merge (`mergeInner` in `src/merge.ts`) combines the edit with the file, and the script's output goes into the file next to the user's change, so the next load computes a total from a total; or
- the save is refused as a conflict, and the user's edit goes to the stash, which looks like inplace losing their typing.

Scripts that change a block *later* (after a fetch, on a timer) have the same effect from the moment they run.

human-review avoids this for the whole page by comparing the live DOM with the file parsed without scripts, and stopping writes to disk when they differ. inplace can do the same per block, which is a better fit: only the blocks a script touches are affected.

## Change

1. **Server.** When serving the page (`page` in `createInplaceServer`), also send each editable block's inner HTML as the file has it, or a short hash of it normalised the way the page will see it. A hash keeps the page small: add `data-hashes` next to `data-editable` on the injected script tag, or serve it as JSON from a new `GET /__inplace/blocks` that the editor fetches on load. Normalise both sides the same way (collapse whitespace, parse and reserialise with parse5 on the server; on the page, compare `el.innerHTML` after the same whitespace collapse), because the browser's serialisation of entities and attribute quotes differs from the source. Write a unit test that the normalisation agrees on a fixture with entities, `<br>`, attributes in different quote styles and `&nbsp;`.
2. **Page, on load.** In `makeEditable`, skip any block whose current content doesn't match its hash: don't make it editable, and give it a `title` such as "This part is filled in by the page's own script, so ask your agent to change it". Keep its id, so comments and the drag handle still work.
3. **Page, later.** After load, watch editable blocks with a `MutationObserver` (`childList`, `characterData`, `subtree`). Ignore mutations that come from the user: set a flag in the `input` handler, and for inplace's own changes (formatting, splitting, reloading) set the flag around them too. Any other change to a block that isn't focused locks it the same way and drops its pending save. Disconnect the observer once the page has been quiet for a while (say 10 seconds after load, or after the first user edit) so it doesn't cost anything during normal editing; scripts that change text much later are rare, and step 2 covers them on the next load.
4. **Agent guide.** In `agent-guide.md`, under "What the ids mean", add that blocks a script changes are left out of editing on the page, and suggest `data-locked` for them when the agent writes such a script, which makes the intent explicit.

## Tests

- e2e: a fixture with a `<td data-id>` whose text a script replaces on load. The cell isn't editable and has the explanatory title; a neighbouring cell is.
- e2e: a script that changes a block 300 ms after load. Typing in that block afterwards doesn't write the script's text into the file.
- e2e: a document without scripts behaves exactly as before (existing suite).

## Done when

No script output can reach the file through a user's edit, blocks without scripts are unaffected, and both suites pass.
