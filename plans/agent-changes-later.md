# Reviewing the agent's changes: what's left

Keep and Undo for each block the agent changed are done (see "Reviewing what the agent changed" in the README, `src/pending.ts` and `src/editor/to-review.ts`), and so are a printable or downloadable copy without the changes still to review and the Alt+Shift+K / Alt+Shift+U shortcuts. The pending changes are kept beside the document as the side data `"pending"`, never in the HTML. What's left are two questions to come back to once there's more use behind them.

## Open questions

- Should the user's own changes be reviewable too, for a document two people edit? [Who wrote what](../README.md) shows who changed what, and a person can undo their own typing. Revisit with accounts in inplace cloud.
- Should a block the user has edited after the agent count as kept? For now it stays pending, so the user can still undo just the agent's words. See how that feels in use.
