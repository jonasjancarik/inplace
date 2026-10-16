# Plans

Work we may do next. Each plan is meant to be picked up on its own, by a person or an agent, without the conversation it came out of. When a plan is done, delete its file in the same commit, or move what's still open into a new plan.

Most of these came from a review of [petergyang/human-review](https://github.com/petergyang/human-review) (MIT), a tool with a similar aim but a different model: the reviewer collects edits and comments in a side panel and sends them to the agent in one batch, and the page is written back to disk as the browser holds it. inplace keeps its own approach (one block changed at a time, stable `data-id`s, merging with the agent's edits). The plans only take the parts that fit it. Where a plan says to copy code from human-review, keep its MIT notice in a comment above the copied part.


| Plan | Size | What it fixes or adds |
| --- | --- | --- |
| [Comments on the page](page-comments.md) | large | Comments only work in the Claude and Codex browsers. |
| [Undo a move](undo-move.md) | medium | A drag to the wrong place can only be undone by dragging back. |
| [Show what changed](review-mode.md) | large | There's no way to read the whole document with every change marked inline, crossed out and added. |

Done and removed from this list: entering text with an input method, safe link addresses, saving when the tab closes, blocks changed by the page's scripts, waiting for the next pause, the agent-status line, the fixes for unusual pages and old words on hover. Their commits are in `git log`, and the README and agent guide describe the result.

[Show what changed](review-mode.md) came from the change highlights rather than that review. [Comments on the page](page-comments.md) is the one that matters most.
