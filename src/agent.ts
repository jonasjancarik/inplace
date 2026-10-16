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

  constructor({ unseenReaders = true, channel = false }: { unseenReaders?: boolean; channel?: boolean } = {}) {
    this.signals = { waits: 0, channel, commandRunning: false, unseenReaders };
  }

  summary(now = Date.now()): { state: AgentState; ago?: number } {
    return agentState(this.signals, now);
  }

  private set(change: Partial<AgentSignals>): void {
    Object.assign(this.signals, change);
    for (const listener of this.listeners) listener();
  }

  /** The agent read the changes or the document. */
  checked(): void {
    this.set({ lastCheck: Date.now() });
  }

  waitStarted(): void {
    this.set({ waits: this.signals.waits + 1, lastAgentAction: Date.now() });
  }

  /** A wait returned, with a pause (`delivered`) or without (timeout, or the agent went away). */
  waitEnded(delivered: boolean): void {
    const now = Date.now();
    this.set({ waits: Math.max(0, this.signals.waits - 1), lastCheck: now, ...(delivered ? { lastDelivery: now } : {}) });
  }

  /** A pause was sent to the channel. */
  sentToChannel(): void {
    if (this.signals.channel) this.set({ lastDelivery: Date.now() });
  }

  agentWrote(): void {
    this.set({ lastAgentAction: Date.now() });
  }

  commandRunning(running: boolean): void {
    this.set({ commandRunning: running });
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
