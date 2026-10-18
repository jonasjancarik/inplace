// Let an agent block until the user pauses (`inplace wait`, `wait_for_edits`),
// for agents that have no other way to be woken by inplace's output.

/** What a wait returns: the change lines up to and including the latest pause, and where to continue from. */
export interface PauseBatch {
  next: number;
  lines: string[];
}

/**
 * The most recent change lines, each with an increasing number, and which of them are
 * `paused after` lines. A wait passes the number it got last time, so a pause that
 * comes between two waits is never missed and lines are never repeated.
 *
 * The numbers count on from the time in milliseconds when the feed started, far faster
 * than lines come, so a number handed out before inplace restarted is lower than any this
 * feed hands out, and a wait that passes one gets everything since the restart instead of
 * waiting for the count to catch up.
 */
export class ChangeFeed {
  private entries: { n: number; line: string; pause: boolean }[] = [];
  private last: number;
  private waiters = new Set<() => void>();
  /** The `next` handed out most recently, where a wait without `after` continues from (0: from the start). */
  delivered = 0;

  constructor(readonly keep = 500, readonly start = Date.now()) {
    this.last = start;
  }

  /** The number of the newest line, or `start` before the first. */
  get latest(): number {
    return this.last;
  }

  add(line: string, pause = false): void {
    this.entries.push({ n: ++this.last, line, pause });
    if (this.entries.length > this.keep) this.entries.splice(0, this.entries.length - this.keep);
    if (pause) for (const wake of [...this.waiters]) wake();
  }

  /**
   * Every line after `after` (0: from the start), paused or not, and the number to continue from.
   * Like `take`, it says so when the lines it should start with are gone.
   */
  since(after: number): PauseBatch {
    const restarted = after !== 0 && (after < this.start || after > this.last);
    const from = after === 0 || restarted ? this.start : after;
    const lines = this.entries.filter((e) => e.n > from).map((e) => e.line);
    if (restarted) {
      lines.unshift("(inplace restarted since your last call, so changes from before the restart may be missing; read the document to catch up)");
    } else if (this.entries.length && this.entries[0].n > from + 1) {
      lines.unshift("(older changes are no longer kept here; read the document to catch up)");
    }
    return { next: this.last, lines };
  }

  /**
   * The lines after `after` (0: from the start) up to the latest pause among them, or null
   * if there's no pause yet.
   */
  take(after: number): PauseBatch | null {
    // A number this feed never handed out comes from before inplace restarted (or from
    // another inplace): start from this feed's first line, and say so.
    const restarted = after !== 0 && (after < this.start || after > this.last);
    const from = after === 0 || restarted ? this.start : after;
    const newer = this.entries.filter((e) => e.n > from);
    const end = newer.findLastIndex((e) => e.pause);
    if (end === -1) return null;
    const lines = newer.slice(0, end + 1).map((e) => e.line);
    if (restarted) {
      lines.unshift("(inplace restarted since your last wait, so changes from before the restart may be missing; read the document to catch up)");
    } else if (this.entries.length && this.entries[0].n > from + 1) {
      // Only the last `keep` lines are kept; say so rather than pretend nothing happened.
      lines.unshift("(older changes are no longer kept here; read the document to catch up)");
    }
    this.delivered = Math.max(this.delivered, newer[end].n);
    return { next: newer[end].n, lines };
  }

  /**
   * Resolves with the lines up to the next pause after `after` (straight away if one is
   * already there), or with null after `timeoutMs` or once `signal` aborts.
   */
  wait(after: number, timeoutMs?: number, signal?: AbortSignal): Promise<PauseBatch | null> {
    const ready = this.take(after);
    if (ready || signal?.aborted) return Promise.resolve(ready);
    return new Promise((ok) => {
      const finish = (batch: PauseBatch | null) => {
        this.waiters.delete(wake);
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        ok(batch);
      };
      const wake = () => {
        const batch = this.take(after);
        if (batch) finish(batch);
      };
      const stop = () => finish(null);
      const timer = timeoutMs === undefined ? undefined : setTimeout(stop, timeoutMs);
      signal?.addEventListener("abort", stop);
      this.waiters.add(wake);
    });
  }
}
