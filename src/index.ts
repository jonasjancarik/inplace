// inplace as a library, for hosts that serve documents themselves: keep each document in a
// DocumentStore of their own, route its requests to createInplaceHandler, and act on the
// change lines and pauses the way the CLI hands them to an agent. A host that knows who is
// using the page can pass `author` to createInplaceHandler, and name its own agent through the
// `by` argument of the Document methods an agent uses, for the marks that show who wrote what.

export { AgentStatus } from "./agent.js";
export {
  type Comment, CommentNotFound, type CommentPersistence, CommentStore, COMMENT_TAGS, type CommentTag, type CommentTagger, type TagRequest,
} from "./comments.js";
export { AGENT_GUIDE_PATH } from "./guide.js";
export { type Author } from "./history.js";
export { BlockConflict, BlockNotFound } from "./htmldoc.js";
export { PauseWatcher } from "./idle.js";
export { pauseEvent } from "./mcp.js";
export { createInplaceHandler, createInplaceServer, type AgentName, Document, type Person, QuoteNotFound, type ServerOptions } from "./server.js";
export { type DocumentStore, FileStore, MemoryStore, type SideData } from "./store.js";
export { type JevOptions, jevTagger } from "./tags.js";
export { ChangeFeed, type PauseBatch } from "./wait.js";
