// inplace as a library, for hosts that serve documents themselves: keep each document in a
// DocumentStore of their own, route its requests to createInplaceHandler, and act on the
// change lines and pauses the way the CLI hands them to an agent.

export { AgentStatus } from "./agent.js";
export {
  type Comment, CommentNotFound, type CommentPersistence, CommentStore, COMMENT_TAGS, type CommentTag, type CommentTagger, type TagRequest,
} from "./comments.js";
export { AGENT_GUIDE_PATH } from "./guide.js";
export { BlockConflict, BlockNotFound } from "./htmldoc.js";
export { PauseWatcher } from "./idle.js";
export { pauseEvent } from "./mcp.js";
export { createMcpHandler, type HostTool, type McpHandlerOptions } from "./mcp-host.js";
export { type ToolDefinition } from "./mcp-rpc.js";
export { DOCUMENT_INFO_TOOL, DOCUMENT_TOOLS, type McpDocument } from "./mcp-tools.js";
export { type Access, createInplaceHandler, createInplaceServer, Document, QuoteNotFound, type ServerOptions } from "./server.js";
export { type DocumentStore, FileStore, MemoryStore, type SideData } from "./store.js";
export { type JevOptions, jevTagger } from "./tags.js";
export { ChangeFeed, type PauseBatch } from "./wait.js";
