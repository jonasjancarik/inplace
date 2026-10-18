// Who wrote each block last, kept beside the document rather than in it. One record per block id:
// the last author, when, who added the block, and a fingerprint of its content. The fingerprint
// is how a change made while inplace wasn't running is noticed at the next start: such a block
// has no author we can name, so it goes back to unknown.

import { type Author, type BlockChange, fingerprints, readAuthor } from "./history.js";

export interface Mark {
  by: Author;
  at: string; // ISO time of the last change
  addedBy?: Author; // set when inplace saw the block being added
  fp: string;
}

export class Authorship {
  private marks = new Map<string, Mark>();

  /** `saved` is what toJSON gave earlier. `source` is the file now: blocks that differ from the saved fingerprint become unknown. */
  constructor(saved: string | null, source: string) {
    try {
      const now = fingerprints(source);
      for (const [id, m] of Object.entries(JSON.parse(saved ?? "{}") as Record<string, Record<string, unknown>>)) {
        const by = readAuthor(m.by);
        if (!by || typeof m.at !== "string" || typeof m.fp !== "string" || now.get(id) !== m.fp) continue;
        const addedBy = readAuthor(m.addedBy);
        this.marks.set(id, { by, at: m.at, ...(addedBy ? { addedBy } : {}), fp: m.fp });
      }
    } catch {
      // nothing saved, or not readable: every block is unknown
    }
  }

  /** Record what one write did. `source` is the file after it. Returns true if anything was recorded. */
  record(changes: BlockChange[], by: Author, source: string, at = new Date()): boolean {
    let touched = false;
    const now = fingerprints(source);
    for (const c of changes) {
      if (c.kind === "removed") touched = this.marks.delete(c.id) || touched;
      else if (c.kind === "moved") continue; // moving a block isn't writing it
      else {
        const fp = now.get(c.id);
        if (!fp) continue;
        const old = this.marks.get(c.id);
        const addedBy = c.kind === "added" ? by : old?.addedBy;
        this.marks.set(c.id, { by: { ...by }, at: at.toISOString(), ...(addedBy ? { addedBy: { ...addedBy } } : {}), fp });
        touched = true;
      }
    }
    return touched;
  }

  /** After a write that isn't anyone's (inplace adding ids), keep the fingerprints matching the file. */
  refit(source: string): boolean {
    const now = fingerprints(source);
    let touched = false;
    for (const [id, m] of this.marks) {
      const fp = now.get(id);
      if (fp && fp !== m.fp) { m.fp = fp; touched = true; }
    }
    return touched;
  }

  /** For the page: each block's last author, when, and who added it. */
  summary(): Record<string, Omit<Mark, "fp">> {
    return Object.fromEntries([...this.marks].map(([id, { fp: _, ...m }]) => [id, m]));
  }

  toJSON(): Record<string, Mark> {
    return Object.fromEntries(this.marks);
  }
}
