# Plans

Work we may do next. Each plan is meant to be picked up on its own, by a person or an agent, without the conversation it came out of. When a plan is done, delete its file in the same commit, or move what's still open into a new plan.

Most of these came from a review of [petergyang/human-review](https://github.com/petergyang/human-review) (MIT), a tool with a similar aim but a different model: the reviewer collects edits and comments in a side panel and sends them to the agent in one batch, and the page is written back to disk as the browser holds it. inplace keeps its own approach (one block changed at a time, stable `data-id`s, merging with the agent's edits). The plans only take the parts that fit it. Where a plan says to copy code from human-review, keep its MIT notice in a comment above the copied part.

All the plans from that review are done and merged: entering text with an input method, safe link addresses, saving when the tab closes, blocks changed by the page's scripts, waiting for the next pause, the agent-status line, the fixes for unusual pages, old words on hover, comments on the page, undo, and the "Show what changed" view. Their commits are in `git log`, and the README and agent guide describe the result. Add new plans here as they come up.

## Open

These came from looking at [Proof](https://github.com/EveryInc/proof-sdk) (MIT, by Every), an editor where people and agents write together. As with human-review, the plans take ideas that fit inplace's model, not its design: Proof owns its editor and document format, while inplace keeps the HTML file as the document.

- [Reviewing the agent's changes: what's left](agent-changes-later.md): printing without the changes still to review, keyboard access beside the block, and two open questions. Keep or Undo for each block itself is done.

Accounts and sharing themselves are inplace cloud's to do, in its own `plans/` folder.
