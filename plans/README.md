# Plans

Work we may do next. Each plan is meant to be picked up on its own, by a person or an agent, without the conversation it came out of. When a plan is done, delete its file in the same commit, or move what's still open into a new plan.

Most of these came from a review of [petergyang/human-review](https://github.com/petergyang/human-review) (MIT), a tool with a similar aim but a different model: the reviewer collects edits and comments in a side panel and sends them to the agent in one batch, and the page is written back to disk as the browser holds it. inplace keeps its own approach (one block changed at a time, stable `data-id`s, merging with the agent's edits). The plans only take the parts that fit it. Where a plan says to copy code from human-review, keep its MIT notice in a comment above the copied part.

The cross-site write fix that came out of the same review is on the branch `claude/zen-lamarr-0938fe` and isn't covered here.

| Plan | Size | What it fixes or adds |
| --- | --- | --- |
| [Enter with an input method](ime-enter.md) | small | Confirming a Japanese or Chinese character with Enter splits the paragraph. |
| [Safe link addresses](link-schemes.md) | small | `javascript:` and `data:` links can be added from the page. |
| [Save when the tab closes](flush-on-close.md) | small | The last moment of typing is lost if the tab closes within the save delay. |
| [Blocks changed by the page's scripts](script-changed-blocks.md) | medium | Editing a block a script filled in writes the script's output into the file. |
| [Wait for the next pause](wait-for-pause.md) | medium | Agents without Claude Code's channel or Monitor have no simple way to react to edits. |
| [Comments on the page](page-comments.md) | large | Comments only work in the Claude and Codex browsers. |
| [Is the agent listening?](agent-status.md) | medium | The page can't tell the user whether anyone is picking up their edits. |
| [Undo a move](undo-move.md) | medium | A drag to the wrong place can only be undone by dragging back. |
| [Small fixes for unusual pages](page-quirks.md) | small | New links and lists can be invisible under CSS resets; "Show" can't reach blocks in a closed tab or accordion. |
| [Old words on hover](old-words-on-hover.md) | small | The page tints the words the agent changed but doesn't say what they replaced. |
| [Show what changed](review-mode.md) | large | There's no way to read the whole document with every change marked inline, crossed out and added. |

The last two came from the change highlights rather than that review: [Old words on hover](old-words-on-hover.md) answers most of the same need as [Show what changed](review-mode.md) at a fraction of the cost, so try it first.

The order is a suggestion: the small fixes first, then comments, which is the largest piece and the one that matters most. [Wait for the next pause](wait-for-pause.md) and [Is the agent listening?](agent-status.md) share the idea of the server knowing who is waiting for edits, so they're easier together.
