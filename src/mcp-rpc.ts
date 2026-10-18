// The JSON-RPC layer of an MCP server, whatever carries the messages (stdin, an HTTP
// POST). Hand-written to keep the dependency count at one; it covers what a
// tools-and-notifications server needs and nothing more.

export const VERSION = "0.1.0";
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export type Message = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export const parseError = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } };

/** What a tool offers an agent: its name, what it does, and the arguments it takes. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/** What the server is: what it tells a client at the start and which tools it runs. */
export interface McpBackend {
  instructions: string;
  tools(): readonly ToolDefinition[];
  /**
   * Runs a tool and returns the text for the agent, or throws an error whose message the agent reads.
   * `client` tells clients apart (empty when there's only one) and `gone` aborts when the caller leaves.
   */
  call(name: string, args: Record<string, unknown>, client: string, gone?: AbortSignal): Promise<string>;
  /** Called at initialize with the client's parameters. */
  initialize?(params: Record<string, unknown>): void;
  /** Whether the server can send notifications (the stdio server can, with Claude Code channels). */
  channels?: boolean;
}

/**
 * Answers one JSON-RPC message. Returns the response, or undefined for a
 * notification, which gets none.
 */
export function mcpHandler(backend: McpBackend) {
  const answer = async (msg: Message, client: string, gone?: AbortSignal): Promise<unknown> => {
    const params = msg.params ?? {};
    switch (msg.method) {
      case "initialize": {
        const asked = String(params.protocolVersion);
        backend.initialize?.(params);
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: backend.channels ? { tools: {}, experimental: { "claude/channel": {} } } : { tools: {} },
          serverInfo: { name: "inplace", version: VERSION },
          instructions: backend.instructions,
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: backend.tools() };
      case "tools/call":
        try {
          const text = await backend.call(String(params.name), (params.arguments ?? {}) as Record<string, unknown>, client, gone);
          return { content: [{ type: "text", text }] };
        } catch (e) {
          return { content: [{ type: "text", text: (e as Error).message }], isError: true };
        }
      default:
        throw Object.assign(new Error(`method not found: ${msg.method}`), { code: -32601 });
    }
  };

  return async (msg: Message, client = "", gone?: AbortSignal): Promise<Record<string, unknown> | undefined> => {
    if (msg.id === undefined || msg.id === null) return undefined; // a notification, e.g. notifications/initialized
    try {
      return { jsonrpc: "2.0", id: msg.id, result: await answer(msg, client, gone) };
    } catch (e) {
      const { code, message } = e as Error & { code?: number };
      return { jsonrpc: "2.0", id: msg.id, error: { code: code ?? -32603, message } };
    }
  };
}
