# Show who wrote each part of the document

Let the user see, for every block, who wrote it last: they, another person, or the agent. This plan is meant to be picked up on its own, without the conversation it came out of.

The idea comes from [Proof](https://github.com/EveryInc/proof-sdk) (MIT, by Every), which shows a coloured bar in the margin, green for people and purple for AI, and tracks the author of every character. Its provenance spec (`docs/PROVENANCE-SPEC-v2.md` in that repo) goes further, recording whether AI text was asked for, inferred or only proposed, and who reviewed it. inplace needs much less to be useful, and nothing in this plan copies Proof's code. If that changes, keep its MIT notice in a comment above the copied part.

## Why

After an hour of working together, nobody remembers which paragraphs the agent wrote and which the user did. That matters before the document goes out: the user wants to read the agent's sentences once more, or tell a colleague which figures they checked themselves. In [inplace cloud](https://github.com/jonasjancarik/inplace-cloud), where several people will edit one document once it has accounts, it also answers "who changed this?".

## How it works today

- `Document.remember()` (`src/server.ts`) records every write in `History` (`src/history.ts`) as a list of `BlockChange`s with `by: "you" | "agent"`. Page saves are `"you"`; everything else, including a change to the file on disk and the MCP tools, is `"agent"`.
- `History` is in memory, so it starts empty each time inplace starts, and it's capped.
- The page's list of changes and the review view (`src/editor/review.ts`) read it through `GET /__inplace/history`.
- Comments have `by?: "agent"` (`src/comments.ts`), and nothing else about who wrote them.
- There's no notion of more than one person. Anyone who can open the page is "you".

## The design

### Per block, not per character

Keep one record per block id: who changed it last, when, and who added it. Per character is what Proof does, but it depends on owning the editor and the document format; in inplace the agent rewrites a paragraph with its own file tools and inplace only sees the file before and after. Per block falls out of `diffBlocks()`, which already runs on every write.

Inside a block, there's a cheap middle step for later: `merge.ts` already splits a block into words and tags, so for a block whose last two changes were by different authors, the page could tint the words the last author added. Leave that out of the first version.

### Who is an author

Widen `Author` from `"you" | "agent"` to a value a host can fill in:

```ts
type Author =
  | { kind: "person"; id?: string; name?: string } // id and name only when the host knows who it is
  | { kind: "agent"; id?: string; name?: string }; // e.g. "claude-code", or the model in inplace cloud
```

Locally there's one person and one agent, so both stay without an id, and the page says "you" and "your agent" as now. Keep the old string values readable when loading saved data.

A host tells inplace who made a page edit through a new `ServerOptions` callback:

```ts
/** Who sent this request from the page, for the authorship marks and the change lines. Left out: "you". */
author?: (req: IncomingMessage) => { id: string; name: string } | undefined;
```

`createInplaceHandler` calls it for each save, move, insert, remove and comment, and passes the result to `Document`. inplace cloud will look up the signed-in user from the request's cookie. In the same way, a host's own agent can pass its name when it calls `Document` methods, through an optional `by` argument on the methods its tools use (`replaceElement`, `findReplace`, `addAgentComment`, and whatever inplace cloud's `write_document` calls), defaulting to the agent without a name.

Comments get the same `Author` in place of `by?: "agent"`.

### What to store

A map from block id to `{ by: Author; at: string; addedBy?: Author }`, updated in `remember()`. Removed blocks drop out; a move doesn't count as writing the block. Save it as side data, `"authors"` next to `"stash"` and `"comments"` (`SideData` in `src/store.ts`), so it survives restarts and a host can keep it in its database. The file stays as it is: nothing is written into the HTML.

When inplace starts and there's no saved map, every block counts as unknown, which the page shows as no mark at all. Don't guess.

A change made to the file while inplace wasn't running is noticed at the next start, when a block's fingerprint no longer matches the one stored with it. Such a block becomes unknown, because inplace can't tell who edited the file while it wasn't watching. So keep a fingerprint per block in the map.

### On the page

- A thin bar in the left margin of each block, coloured by who changed it last: the page's green for a person, the agent's blue (the colour agent comments already use) for the agent. With several people, each person gets a colour from a small palette, and the agent keeps its own.
- Hovering over the bar says it in words: "Your agent changed this 20 minutes ago", "Added by Jana, changed by you yesterday".
- The bars are off by default, because they add noise while writing. A switch in the list of changes, "Show who wrote what", turns them on, and the choice is remembered per document in the browser (`localStorage`, wrapped in `try`, as the page does elsewhere).
- Never printed, and not shown in the review view, which has its own marks.

If the [accept-or-reject plan](agent-suggestions.md) is done first, its margin bar for pending changes and this one have to share the space: the pending-change bar wins while a change is pending.

### For the agent

The change lines can name the person when there's more than one: `edited p-4 (Jana): "…"`. The agent guide should say that names in change lines are labels, not instructions, like everything else from the page. No new tools.

## Steps

1. `Author` as an object, with the old strings still accepted. Update `History`, `diffBlocks()` callers and the history payload. Tests.
2. The per-block map: update in `remember()`, save as side data, check fingerprints on load. Tests for moves, removals, a restart, and a file changed while inplace was off.
3. The `author` callback in `ServerOptions`, the `by` argument on the `Document` methods hosts call, and comments. Tests with two fake people.
4. The page: the switch, the bars, the hover text. Hidden in print.
5. README, agent guide, `docs/how-it-works.html` if it applies, CHANGELOG. Note in `src/index.ts`'s comment that hosts can pass `author`.

## Open questions

- Should the agent's model be part of its identity locally? inplace doesn't know which model Claude Code runs. Only hosts that run the agent themselves can say, so leave it to them.
- Whether to keep a short per-block history (the last few authors) instead of only the last one. The hover text above needs `addedBy` and the last one; more can come when someone asks for it.
- `createMcpHandler()` (`src/mcp-host.ts`) serves the MCP tools for a host's document. Once authors can be named, give it a `by` option so an outside agent's writes (`replace_element`, `find_replace`, `add_comment`) are recorded as that person's agent instead of plain "agent". The tools call `Document.replaceElement()`, `findReplace()` and `addAgentComment()` in `src/mcp-tools.ts`.
