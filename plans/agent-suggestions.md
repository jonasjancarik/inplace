# Accept or reject the agent's changes

Let the user go through what the agent changed, block by block, and keep or throw away each change, the way tracked changes work in a word processor. This plan is meant to be picked up on its own, without the conversation it came out of.

The idea comes from [Proof](https://github.com/EveryInc/proof-sdk) (MIT, by Every), a collaborative editor for people and agents where an agent's edits arrive as suggestions the user accepts or rejects. Proof can do that because agents edit its documents only through its own API, so a suggestion never touches the text until it's accepted. inplace can't work that way: the agent edits the HTML file with its own tools, and the file is the document. So here the change is already in the file, and rejecting it puts the old version back. Nothing in this plan copies Proof's code. If that changes, keep its MIT notice in a comment above the copied part.

## Why

Today the page highlights what the agent changed for a moment, and "Show what changed" lists every change in a read-only view. Neither lets the user say "not this one". To undo an agent edit, they have to retype it or ask the agent to change it back. That makes larger rewrites risky: people hold back from asking for them, or accept a change they only half agree with. A per-block Keep / Undo turns a rewrite into something to review, not something to repair.

## How it works today

- `Document.remember()` (`src/server.ts`) compares the file before and after each write with `diffBlocks()` (`src/history.ts`) and adds a `HistoryEntry` to `History`, with `by: "you"` for edits saved from the page and `by: "agent"` for anything else (the file changed on disk, or an MCP tool such as `replace_element`).
- A `BlockChange` keeps the block's id, its tag, whether it was added, removed, changed or moved, its plain text before and after (cut at 600 characters), and for removed and moved blocks the `Place` it was in. It doesn't keep the old HTML, so a change can't be reversed from the history alone.
- The user's own moves, additions, removals and heading changes can be undone through `pushUndo()` / `reverse()` / `undo()`. An `UndoStep` keeps the cut needed to restore the file exactly (`restore`), a fingerprint of the file just after the change, and the element's old `Place`. If the file has changed since, `reverse()` puts the element back next to an old neighbour, or throws `UndoGone`. There's no undo for typing; the browser's own ⌘Z handles that while the block is focused.
- `src/editor/agent-changes.ts` tints the blocks the agent changed after a reload. `src/editor/review.ts` is the read-only "Show what changed" view, scoped to the agent's changes or to all of them, which puts the old words in the page crossed out.

## The design

### What gets reviewed

Each block the agent changed since the user last decided on it is one **pending change**: added, removed, changed (text or tag) or moved. Several agent writes to the same block combine into one pending change, the way `combinedChanges()` in `review.ts` already combines them. A change inside a block that the agent also added counts as part of the addition. A new table is one change, not one per cell, as in `showChanges()`.

Keeping a change only clears it from the list. Undoing it writes the file:

- **changed**: put the block's old HTML back. If the user or the agent has changed the block again since, combine with `merge.ts` the same way a page save is combined with a concurrent agent edit: undo the agent's words and keep the later ones. If they overlap, refuse with a message, as `UndoGone` does.
- **added**: remove the block, but only if it's unchanged since the agent added it. Otherwise refuse ("You've changed it since; remove it on the page").
- **removed**: put the old HTML back at its old `Place`, falling back to an old neighbour the way `reverse()` does.
- **moved**: move it back, with the same fallback.

An undone change is written as the user's edit (`by: "you"`), so it shows up in the change lines (`undid agent's change to p-4`) and the agent learns that the user didn't want it. That line matters: without it the agent may make the same change again in its next turn. The agent guide should say what to do with it: don't redo the change, and if it seemed necessary, ask in a comment.

### What to store

Add the old HTML to the history, per block, when the change is by the agent. `diffBlocks()` already has both versions of the file; keep the block's outer HTML before the change (and for moves and removals its `Place`, which is kept already). Store it in a new structure next to `History`, a `Suggestions` list in `src/history.ts` or its own file, keyed by block id:

```ts
interface PendingChange {
  id: string;
  kind: "added" | "removed" | "changed" | "moved";
  before?: string; // the block's HTML before the agent's first change in this run of changes
  place?: Place; // where it was, for removals and moves
  afterPrint: string; // a fingerprint of the block's HTML right after the agent's latest change
  since: string; // ISO time of the first change
}
```

Unlike `History`, which is in memory for as long as inplace runs, pending changes should survive a restart: a user may want to review tomorrow what the agent did tonight. Save them as a new kind of side data, `"pending"` next to `"stash"` and `"comments"` in `SideData` (`src/store.ts`), so the file stays the document and a host such as inplace cloud keeps them in its own database. Cap the size: drop the oldest when there are more than a few hundred, and don't keep `before` for blocks larger than, say, 50 kB (those can only be kept, with a note that they're too large to undo).

When the user edits a block that has a pending change, the change stays pending: they may still want to undo the agent's part. When the agent changes it again, `before` stays the first version and `afterPrint` is updated.

### On the page

Not a mode the user has to turn on. Pending changes are always recorded, and the page shows them in two places:

- The **list of changes** (the corner button) gets a section at the top, "Your agent's changes to review (5)", with Keep all and, per change, the block's first words and Keep / Undo. Clicking a change scrolls to it.
- **In the page**, each block with a pending change gets a thin bar in the left margin in the agent's colour, and on hover a small Keep / Undo pair beside it, next to where the drag handle and + already appear. For a changed block, hovering also shows the old words crossed out, which `src/editor/words.ts` already does for the latest change ("Old words on hover").

Undo needs the page to reload the block like any other write. Reuse the `/__inplace/undo` endpoint shape: `POST /__inplace/suggestion/undo` and `/suggestion/keep` with the block id, and `keep-all`. The page fetches the pending list with the history (`GET /__inplace/history`), and the history event already tells it when to fetch again.

Nothing of this is written into the HTML or printed. Proof stores authorship as `<span data-proof="authored">` inside the document, and its agent docs list bugs that came from that (searches failing on the tags, text drifting after suggest-and-reject cycles). Keeping it outside the file avoids the whole class of problems.

### For the agent

- A line when the user decides: `kept agent's change to p-4` isn't worth logging; `undid agent's change to p-4: "…new words…" → "…old words…"` is.
- `inplace guide` and the MCP instructions: the user reviews your changes and may undo some. Don't make an undone change again; if you think it's needed, say why in a comment.
- No new tool. The agent doesn't need to know which changes are still pending.

### What "suggesting" means then

Proof's toggle decides whether the agent's edits are applied directly or proposed. Here the edit is always applied, and the user always gets to undo it. What a user may still want is to keep the file clean while they review, for instance before printing. That's a later step, not part of this plan: an option to export or print the document with pending changes undone.

## Steps

1. Record pending changes: `diffBlocks()` returns each block's old outer HTML for agent writes, `Document` keeps the `PendingChange` list, saves and loads it as side data, and caps it. Tests in `test/` for combining several agent writes to one block, a user edit on top, and a restart.
2. Undo on the server: `Document.undoAgentChange(id)` for each kind, using `merge.ts` for changed blocks and the `reverse()` fallback for places. Write as the user, log the line. Tests for each kind, for the refusals, and for an undo racing an agent write.
3. Endpoints and the history payload.
4. The page: the review section in the list of changes, the margin bar, and Keep / Undo on hover. Keyboard reachable, and hidden in print (`@media print`) and in the review view.
5. The agent guide, the MCP instructions, the README ("Reviewing what the agent changed"), `docs/how-it-works.html` if it shows the flow, and the CHANGELOG.
6. An e2e test (Playwright, `e2e/`): the agent rewrites two paragraphs and adds one; the user undoes one rewrite and the addition and keeps the other; the file matches.

## Open questions

- Should the user's own changes be reviewable too, for a document two people edit? Probably not here: [authorship](authorship.md) shows who changed what, and a person can undo their own typing. Revisit with accounts in inplace cloud.
- Should a block the user has already edited after the agent count as kept? Simpler for the user, but it loses the "undo just the agent's words" case. Start with keeping it pending, and see how it feels.
