# Plans

Work we may do next. Each plan is meant to be picked up on its own, by a person or an agent, without the conversation it came out of. When a plan is done, delete its file in the same commit, or move what's still open into a new plan.

Most of these came from a review of [petergyang/human-review](https://github.com/petergyang/human-review) (MIT), a tool with a similar aim but a different model: the reviewer collects edits and comments in a side panel and sends them to the agent in one batch, and the page is written back to disk as the browser holds it. inplace keeps its own approach (one block changed at a time, stable `data-id`s, merging with the agent's edits). The plans only take the parts that fit it. Where a plan says to copy code from human-review, keep its MIT notice in a comment above the copied part.

All the plans from that review are done and merged: entering text with an input method, safe link addresses, saving when the tab closes, blocks changed by the page's scripts, waiting for the next pause, the agent-status line, the fixes for unusual pages, old words on hover, comments on the page, undo, and the "Show what changed" view. Their commits are in `git log`, and the README and agent guide describe the result. Add new plans here as they come up.
