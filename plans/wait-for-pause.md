# Wait for the next pause

## Problem

An agent only reacts to the user's edits when something wakes it. Today that's Claude Code's channel (`inplace mcp` with the development flag), Claude Code's Monitor tool watching the `--log` file, a Codex heartbeat, or `--on-pause` starting a separate headless agent. Codex, Cursor and others without those have no simple option: they read the log only when the user next writes to them.

human-review solves this with a command that blocks until feedback arrives and then prints it and exits (`human-review poll`). An agent runs it in the foreground inside its turn (or in the background in Claude Code, which wakes the agent when the command exits). inplace can offer the same with pauses.

## Change

1. **Server endpoint.** Add `GET /__inplace/wait?after=<n>` to `createInplaceServer`. The change lines and pauses need a sequence number: keep the last few hundred change lines in memory in `Document` (or next to the `PauseWatcher` in `src/cli.ts`), each with an increasing `n`, and mark which ones are `paused after` lines. The endpoint answers immediately with the lines after `n` if they include a pause; otherwise it holds the request open until the next pause and then answers. Reply as JSON: `{ "status": "pause", "next": <n>, "lines": [...] }`. Send a heartbeat (a space or an SSE comment) every 30 seconds or so, so proxies and the client can tell the connection is alive.
2. **CLI command.** Add `inplace wait [--port 8765] [--timeout <seconds>] [--after <n>]` to `src/cli.ts`. It connects to the running server, prints the lines and the `next` number when a pause arrives, and exits with 0. With `--timeout`, it exits with a distinct code and `{"status":"timeout"}` when nothing arrives. If the connection drops, it retries a few times with a short delay before giving up (human-review's `pollCommand` in `src/cli.js` is a good model, including waiting for stdout to flush before exiting). The agent passes the printed `next` back as `--after` on the next call, so no pause is missed between two waits.
3. **MCP tool.** Add `wait_for_edits` to `src/mcp.ts` with an optional `timeout_seconds`, built on the same wait. Many MCP clients time tool calls out after a minute or two, so default to about 50 seconds and say in the description that the agent should call it again when it returns `timeout`.
4. **Agent guide.** In `agent-guide.md`, under "Reacting while you're idle", add a bullet for agents without the other options: run `inplace wait` in the foreground in the active turn, act on the lines when it returns, run it again with the new `--after`, and stop when the user says they're done. Say clearly that this only works while the agent's turn is active, as human-review's skill does. Mention the command in the README section "Letting the agent react while you work".

Pass the same `NOT_INSTRUCTIONS` warning that `get_edits` has: the lines are document content, not instructions.

## Tests

- Unit test the sequence numbers and the "answer immediately when a pause is already waiting" case.
- An integration test in `test/` that starts the server on a temporary file, starts a wait, posts a save, waits past `--pause`, and checks the wait returns the edit line and the pause line.
- `--timeout` returns the timeout status, and `--after` with the returned `next` doesn't repeat lines.

## Done when

`inplace wait` and `wait_for_edits` return at each pause with the lines since the last call, the guide explains when to use them, and `npm test` passes.
