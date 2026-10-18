# Plans

Work we may do next. Each plan is meant to be picked up on its own, by a person or an agent, without the conversation it came out of. When a plan is done, delete its file in the same commit, or move what's still open into a new plan.

Most of these came from a review of [petergyang/human-review](https://github.com/petergyang/human-review) (MIT), a tool with a similar aim but a different model: the reviewer collects edits and comments in a side panel and sends them to the agent in one batch, and the page is written back to disk as the browser holds it. inplace keeps its own approach (one block changed at a time, stable `data-id`s, merging with the agent's edits). The plans only take the parts that fit it. Where a plan says to copy code from human-review, keep its MIT notice in a comment above the copied part.

All the plans from that review are done and merged: entering text with an input method, safe link addresses, saving when the tab closes, blocks changed by the page's scripts, waiting for the next pause, the agent-status line, the fixes for unusual pages, old words on hover, comments on the page, undo, and the "Show what changed" view. Their commits are in `git log`, and the README and agent guide describe the result. Add new plans here as they come up.

## Open

These came from looking at [Proof](https://github.com/EveryInc/proof-sdk) (MIT, by Every), an editor where people and agents write together. As with human-review, the plans take ideas that fit inplace's model, not its design: Proof owns its editor and document format, while inplace keeps the HTML file as the document.

- [Accept or reject the agent's changes](agent-suggestions.md): Keep or Undo for each block the agent changed.
- [Show who wrote each part of the document](authorship.md): a margin mark per block for its last author, with a way for hosts to name the people.
- [Let a host serve the MCP tools for a document it already has](mcp-for-hosts.md): what inplace cloud needs so people can connect their own agent to a document there.

- [Pages that can only be read or commented on](page-access.md): what inplace cloud needs to share a document with people who may only comment or read.

Accounts and sharing themselves are inplace cloud's to do, in its own `plans/` folder.
