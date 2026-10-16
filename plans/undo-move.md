# Undo a move

## Problem

Dragging a paragraph, item, row or section to another place is saved straight away (`POST /__inplace/move`, `Document.moveBlock`). If it lands in the wrong place, the only way back is to drag it again, which is fiddly when it went far, and ⌘Z does nothing because the browser's own undo doesn't know about the move. Adding and removing blocks have the same gap, though removal is less risky since only empty blocks can be removed.

human-review keeps every delete and move restorable for the life of the page, with an Undo on each entry in its list and ⌘Z right after the gesture. inplace can do the same through the server, which is more robust because it works after a reload too.

## Change

1. **Server.** When `moveBlock` succeeds, it already knows the element's old neighbour. Record in the history entry (or a small undo list in `Document`) enough to reverse it: the id, the sibling it was before or after, and the parent. Add `POST /__inplace/undo` with `{ kind: "move", id }` that moves the element back with `moveBlock`, as long as the old neighbour is still in the same parent; if it isn't, try the other neighbour, and otherwise refuse with "This can't be undone any more, because the elements around it have changed". Log it as an ordinary move line, with "(undone)" so the agent understands what happened.
2. Do the same for blocks the user added and that are still empty (undo = remove), and for removed blocks (undo = insert the same tag and empty content back where it was, which is what was removed). Retagging (p ↔ h2) is undone by retagging back.
3. **Page.**
   - After a move, show "Moved. Undo" in the status pill for about six seconds, with Undo as a button.
   - ⌘Z / Ctrl+Z when the caret isn't in a block that has typing to undo (no `input` since the move) undoes the last structural change. Keep a timestamp of the last `input` event, as human-review does (`lastInputAt` in `sdk.js`), so ⌘Z right after typing stays the browser's own text undo.
   - In the list of changes, the user's own moves, additions, removals and heading changes get an "Undo" link while they can still be undone.
4. Only the user's own changes get Undo; the agent's are for the agent to change.

## Tests

- Unit tests for undoing a move, including when the old neighbour has moved or been removed since.
- e2e: drag an item, click Undo in the pill, check the file is back to the original bytes.
- e2e: drag, then ⌘Z, same check; and type, then ⌘Z, check that only the typing is undone.

## Done when

A move, addition, removal or heading change by the user can be undone from the pill, ⌘Z or the list, the file returns to what it was, and the suites pass.
