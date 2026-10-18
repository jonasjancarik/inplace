# Pages that can only be read or commented on

Let a host decide, per request, whether the person on the page may edit it, only comment, or only read. This plan is meant to be picked up on its own, without the conversation it came out of. inplace cloud needs it for sharing (`plans/accounts-and-sharing.md` in that repo); locally, it also makes `--host` safer when the page is shown to people who should only comment.

## How it works today

Anyone who reaches the page can do everything: type, move, add and remove blocks, undo, resolve set-aside edits, and comment. `createInplaceHandler` (`src/server.ts`) only checks the `Host` header (`hostAllowed` / `allowHosts`). The page script (`src/editor/`) makes every unlocked block editable once it loads.

## The design

A new `ServerOptions` callback:

```ts
/** What the person sending this request may do. Left out: "edit". */
access?: (req: IncomingMessage) => "edit" | "comment" | "view";
```

- **The server enforces it.** Refuse with 403 the editing actions (`save`, `move`, `retag`, `insert`, `remove`, `undo`, `stash/resolve`, and the actions from the [accept-or-reject plan](agent-suggestions.md)) below `"edit"`, and the comment actions (add, edit, delete, answer, dismiss) below `"comment"`. Reading the page, the history, the comments and the event stream stays open to all three.
- **The page follows it.** The handler puts the level into the page's settings, as it does for other per-page values. With `"comment"`, blocks aren't editable and the drag handle, + and formatting toolbar are hidden, but selecting text still offers Comment, and comment markers and the list of changes work. With `"view"`, Comment goes too, and comments are shown read-only. A short note in the list of changes says why ("You can comment on this document, but not edit it").
- **A CLI option for the local case.** `--comment-only` makes every request `"comment"`. Useful for showing a draft on your network without letting anyone type in it. `--view-only` likewise.

## Steps

1. The option and the server checks, with a test per action and level.
2. The page: per-level setup in the editor script, the note in the list of changes. An e2e test that a comment-only page can comment and can't type.
3. `--comment-only` and `--view-only`, README and CHANGELOG.
