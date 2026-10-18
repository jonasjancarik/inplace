// inplace as a library, for hosts that serve documents themselves: keep each document in a
// DocumentStore of their own, route its requests to createInplaceHandler, and act on the
// change lines and pauses the way the CLI hands them to an agent.

export { AgentStatus } from "./agent.js";
export { type Comment, CommentNotFound, type CommentPersistence, CommentStore } from "./comments.js";
export { AGENT_GUIDE_PATH } from "./guide.js";
export { BlockConflict, BlockNotFound } from "./htmldoc.js";
export { PauseWatcher } from "./idle.js";
export { pauseEvent } from "./mcp.js";
export { createInplaceHandler, createInplaceServer, Document, QuoteNotFound, type ServerOptions } from "./server.js";
export { type DocumentStore, FileStore, MemoryStore, type SideData } from "./store.js";
export { ChangeFeed, type PauseBatch } from "./wait.js";
