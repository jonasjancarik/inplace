// What inplace can tell about the agent picking up the user's edits, for one line on
// the page. Agents read inplace's output in several ways, and some of them (stdout,
// a --log file) can't be seen at all, so this only ever states what was observed.

export type AgentState = "waiting" | "working" | "checked" | "unknown" | "none";

export interface AgentSignals {
  /** `inplace wait` or `wait_for_edits` calls open right now. */
  waits: number;
  /** An MCP client that declared the Claude Code channel capability is attached. */
  channel: boolean;
  /** The --on-pause command is running. */
  commandRunning: boolean;
  /** When the agent last asked for the changes or the document (a pull, or a wait ending). */
  lastCheck?: number;
  /** When a pause was last handed to a wait or the channel. */
  lastDelivery?: number;
  /** When the agent last changed the file, or last started a wait. */
  lastAgentAction?: number;
  /** stdout, a --log file or channel messages may be read by an agent inplace can't see. */
  unseenReaders: boolean;
}

/** How long after a pause was handed over the agent still counts as working on it. */
export const WORKING_MS = 5 * 60_000;

/**
 * The mark beside the blocks of one pause: "picked" (an eye) when the agent took the pause in a
 * way that also shows when it's done, "sent" (an eye that fades) when inplace can't tell when
 * it's done, "done" (a check that fades) once the agent has moved on.
 */
export type SeenMark = "picked" | "sent" | "done";

/** One pause's mark, for the page. `age`: milliseconds since the mark was set, as of the summary. */
export interface SeenPause {
  ids: string[];
  mark: SeenMark;
  age: number;
}

/** How long a "sent" or "done" mark stays in the summary; the page fades it out well before. */
export const FADING_MARK_MS = 10_000;
/** How many recent pauses keep their marks. */
const KEEP_PAUSES = 5;

/** The line to show, and for "checked" how many seconds ago. Never says that nothing is listening. */
export function agentState(s: AgentSignals, now = Date.now()): { state: AgentState; ago?: number } {
  if (s.commandRunning) return { state: "working" };
  if (s.lastDelivery !== undefined && now - s.lastDelivery < WORKING_MS &&
      (s.lastAgentAction === undefined || s.lastAgentAction <= s.lastDelivery)) return { state: "working" };
  if (s.waits > 0 || s.channel) return { state: "waiting" };
  if (s.lastCheck !== undefined) return { state: "checked", ago: Math.max(0, Math.round((now - s.lastCheck) / 1000)) };
  return { state: s.unseenReaders ? "unknown" : "none" };
}

/** The signals for one document, with a listener for each change. */
export class AgentStatus {
  private signals: AgentSignals;
  private listeners = new Set<() => void>();
  /** Blocks the user changed since the last pause. */
  private editing = new Set<string>();
  /** The latest pauses, oldest first; "pending" until the agent gets them, and not shown. */
  private pauses: { ids: Set<string>; mark: SeenMark | "pending"; at: number }[] = [];

  constructor({ unseenReaders = true, channel = false }: { unseenReaders?: boolean; channel?: boolean } = {}) {
    this.signals = { waits: 0, channel, commandRunning: false, unseenReaders };
  }

  summary(now = Date.now()): { state: AgentState; ago?: number; seen: SeenPause[] } {
    this.pauses = this.pauses.filter((p) => now - p.at < (p.mark === "sent" || p.mark === "done" ? FADING_MARK_MS : WORKING_MS));
    const seen = this.pauses.flatMap((p) => p.mark === "pending" || !p.ids.size ? [] : [{ ids: [...p.ids], mark: p.mark, age: now - p.at }]);
    return { ...agentState(this.signals, now), seen };
  }

  /** The user changed these blocks. An earlier pause's mark no longer applies to them. */
  edited(ids: readonly string[]): void {
    let changed = false;
    for (const id of ids) {
      this.editing.add(id);
      // Its latest change hasn't reached the agent yet, whatever happened to the earlier one.
      for (const p of this.pauses) if (p.ids.delete(id) && p.mark !== "pending") changed = true;
    }
    if (changed) this.set({});
  }

  /** The user paused: the blocks changed since the last pause wait for the agent. */
  paused(): void {
    this.pauses.push({ ids: this.editing, mark: "pending", at: Date.now() });
    this.pauses = this.pauses.slice(-KEEP_PAUSES);
    this.editing = new Set();
  }

  /** Move every pause marked `from` to `to`; true if there was one. */
  private advance(from: SeenMark | "pending", to: SeenMark): boolean {
    const now = Date.now();
    let changed = false;
    for (const p of this.pauses) if (p.mark === from) [p.mark, p.at, changed] = [to, now, true];
    return changed;
  }

  private set(change: Partial<AgentSignals>): void {
    Object.assign(this.signals, change);
    for (const listener of this.listeners) listener();
  }

  /** The agent read the changes or the document. */
  checked(): void {
    this.set({ lastCheck: Date.now() });
  }

  /** A wait started. The agent waits again only once it's done with what the last one returned. */
  waitStarted(): void {
    this.advance("picked", "done");
    this.set({ waits: this.signals.waits + 1, lastAgentAction: Date.now() });
  }

  /** A wait returned, with a pause (`delivered`) or without (timeout, or the agent went away). */
  waitEnded(delivered: boolean): void {
    const now = Date.now();
    if (delivered) this.advance("pending", "picked");
    this.set({ waits: Math.max(0, this.signals.waits - 1), lastCheck: now, ...(delivered ? { lastDelivery: now } : {}) });
  }

  /** The agent read the change lines without waiting (get_edits), so there's no telling when it's done. */
  pulled(): void {
    this.advance("pending", "sent");
    this.checked();
  }

  /** A pause was sent to the channel. */
  sentToChannel(): void {
    if (!this.signals.channel) return;
    this.advance("pending", "sent");
    this.set({ lastDelivery: Date.now() });
  }

  agentWrote(): void {
    this.set({ lastAgentAction: Date.now() });
  }

  /** The --on-pause command started or exited. A run starts only after the one before it has finished. */
  commandRunning(running: boolean): void {
    this.advance("picked", "done");
    if (running) this.advance("pending", "picked");
    this.set({ commandRunning: running });
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
