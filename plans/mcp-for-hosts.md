# Let a host serve the MCP tools for a document it already has

Export inplace's MCP server in a form a host such as [inplace cloud](https://github.com/jonasjancarik/inplace-cloud) can mount on its own HTTP server, for one `Document` it already holds, behind its own sign-in. This plan is meant to be picked up on its own, without the conversation it came out of. It's the part of inplace cloud's "connect your own agent" plan (`plans/remote-mcp.md` in that repo) that belongs here.

## Why

inplace cloud runs its own agent on each document. People who already work with Claude Code, Codex or Cursor want to point that agent at a document in the cloud instead, the way [Proof](https://github.com/EveryInc/proof-sdk)'s "Add agent" connects an outside agent to a hosted document. inplace already has everything that agent needs as MCP tools (`get_edits`, `wait_for_edits`, `read_document`, `replace_element`, `find_replace`, the comment tools), and `inplace mcp --http` already serves them over HTTP with a token. But that server opens a file by path, runs the page on its own port, and lives in its own process. A host needs the same tools bound to a document it serves itself.

## How it works today

- `src/mcp.ts` holds a hand-written JSON-RPC layer (`mcpHandler()`), a `Session` class that owns one open document, and two transports: `runMcpServer()` over stdio and `runMcpHttpServer()` over HTTP at `/mcp/<token>` or `/mcp` with a bearer token.
- `Session.open()` takes a file path, creates a `FileStore`, a `Document`, a `PauseWatcher`, a `ChangeFeed` and an `AgentStatus`, and starts `createInplaceServer()` on a port. `close_document` stops it. Every other tool works on `session.doc`.
- `src/index.ts` exports `Document`, `createInplaceHandler`, `PauseWatcher`, `ChangeFeed`, `AgentStatus` and `pauseEvent()`, but nothing from `mcp.ts` that serves tools.
- inplace cloud's own agent (`src/agent.ts` there) reimplements the same tools on `Document` for its model, so the two lists can drift.

## The design

Split `Session` into the part that opens and serves a file, which stays in `mcp.ts` for the CLI, and the part that runs tools on a document, which becomes exported:

```ts
export interface McpDocument {
  doc: Document;
  feed: ChangeFeed; // the host's change lines and pauses
  agent: AgentStatus; // so the page shows that an agent is waiting
  name: string; // shown to the agent in instructions and results
  url?: string; // the page's address, returned to the agent so it can give it to the user
}

/** An MCP request handler for one document: JSON-RPC over HTTP POST, for a host to mount behind its own sign-in. */
export function createMcpHandler(target: McpDocument, options?: { instructions?: string; tools?: string[]; extraTools?: HostTool[]; by?: Author })
  : (req: IncomingMessage, res: ServerResponse, body: string) => Promise<void>;
```

- The handler checks no token; the host decides who may reach it.
- `open_document` and `close_document` aren't offered. In their place, the first call of any tool returns the agent guide once, as `open_document` does now, and `url` is returned by a small `document_info` tool.
- `extraTools` lets the host add its own tools next to inplace's, each a name, description, input schema and function. inplace cloud adds `search_sources` and `read_source` so an outside agent can read the project's uploads.
- `tools` lets the host leave some out (a read-only link might offer only `read_document`, `get_comments` and `get_edits`).
- `by` is the author recorded for the tools' writes, once the [authorship plan](authorship.md) is in. Until then, writes are by "agent" as today.
- Notifications stay out: Claude Code channels only work over stdio. An HTTP client follows edits with `wait_for_edits`, which already long-polls. Note the timeout a host's proxy needs for that.
- Several clients at once on one document must work: each MCP session gets its own `seen` counter for `get_edits` / `wait_for_edits`. Today that counter is on `Session`; keep one per `Mcp-Session-Id`, or per handler call when the client sends none.

`runMcpHttpServer()` then becomes `Session.open()` plus `createMcpHandler()` behind the token check, so the CLI keeps working the same way and the two paths can't drift.

Optionally, export the tool definitions (names, descriptions, input schemas) as data too, so inplace cloud's own agent can build its tool list from them instead of keeping a copy.

## Steps

1. Move the tool implementations from `Session` onto a class built around `McpDocument`; keep `Session` as the CLI's wrapper. No behaviour change; the existing MCP tests must pass untouched.
2. Per-client `seen` counters, with a test of two clients waiting on one document.
3. `createMcpHandler()` with `tools`, `instructions` and `document_info`, exported from `src/index.ts`. Tests that call it with a `MemoryStore` document.
4. Export the tool definitions.
5. README ("inplace as a library") and CHANGELOG.
