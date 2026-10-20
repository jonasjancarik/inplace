// What the server sends the page, as the editor uses it. These follow the server's own types:
// BlockChange and HistoryEntry in src/history.ts, PendingSummary in src/pending.ts, Comment in src/comments.ts, the agent summary
// in src/agent.ts, StashEntry and the replies in src/server.ts, and src/anchor.ts.

/** Who made a change; see Author in src/history.ts. */
interface Author {
  kind: "person" | "agent";
  id?: string;
  name?: string;
}

/** The last author of a block, from the server's authors map. */
interface AuthorMark {
  by: Author;
  at: string;
  addedBy?: Author;
}

/** A change to one block, as recorded in the history. */
interface BlockChange {
  id: string;
  kind: "added" | "removed" | "changed" | "moved";
  tag: string;
  fromTag?: string;
  before?: string;
  after?: string;
  place?: { parent: string; prev?: string; next?: string };
}

interface HistoryEntry {
  n: number;
  by: Author;
  started: string;
  at: string;
  changes: BlockChange[];
}

type UndoKind = "move" | "add" | "remove" | "retag";

/** One of the agent's changes the user hasn't kept or undone yet; see PendingSummary in src/pending.ts. */
interface ToReview {
  id: string;
  kind: "added" | "removed" | "changed" | "moved";
  tag: string;
  moved?: boolean;
  before?: string;
  since: string;
  reason?: string;
  undoable: boolean;
}

/** A comment on the page. Named so it doesn't clash with the DOM's Comment node. */
interface PageComment {
  n: number;
  id: string;
  quote?: string;
  prefix?: string;
  suffix?: string;
  text: string;
  by?: Author;
  from?: Author;
  options?: string[];
  answer?: string;
  dismissed?: boolean;
  status: "open" | "done";
  created: string;
  resolved?: string;
  reply?: string;
}

/** An edit set aside, with what the block holds now (null once it's gone). */
interface StashEntry {
  n: number;
  id: string;
  mine: string;
  theirs: string;
  at: string;
  current: string | null;
  changed: boolean;
}

type AgentSummary = (
  /** `ago`: seconds since the agent last checked, as of when the summary was sent. */
  | { state: "checked"; ago: number }
  | { state: "waiting" | "working" | "unknown" | "none"; ago?: undefined }
) & { seen?: SeenPause[] };

/**
 * The mark beside the blocks of one pause (see SeenMark in src/agent.ts): "picked", an eye until the
 * agent is done; "sent", an eye that fades; "done", a check that fades. `age` is in milliseconds.
 */
interface SeenPause {
  ids: string[];
  mark: "picked" | "sent" | "done";
  age: number;
}

/** The JSON reply to a POST to /__inplace/<action>; which fields are set depends on the action. */
interface Reply {
  version?: string;
  merged?: boolean;
  stash?: number;
  error?: string;
  current?: string;
  id?: string;
  html?: string;
  editable?: string[];
  movable?: string[];
}

interface QuoteContext {
  quote: string;
  prefix: string;
  suffix: string;
}

/** The comment anchoring helpers the page imports from /__inplace/anchor.js, compiled from src/anchor.ts. */
interface Anchoring {
  buildContext(text: string, start: number, end: number): QuoteContext;
  findQuote(text: string, ctx: QuoteContext): { start: number; end: number; exact: boolean } | null;
}
