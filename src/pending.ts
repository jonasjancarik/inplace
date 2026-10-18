// The agent's changes the user hasn't kept or undone yet, one per block, kept beside the document
// rather than in it. The agent writes the file with its own tools, so its changes are already in
// the file; undoing one puts the block back the way it was before the agent's first change to it.
// Several agent writes to one block are one change, and so is everything inside a block the
// agent added. The user's own edits on top leave the change pending: they may still want to undo
// the agent's part, which is then combined with theirs as a page save is (merge.ts).

import { createHash } from "node:crypto";

import { type Author, type BlockChange, copyOf, type Place, placeOf, plainText } from "./history.js";
import { cutElement, findBlock, ID_ATTR, leadOf, moveBlock, type Node, parse, putChunk, putLast } from "./htmldoc.js";
import { mergeInner } from "./merge.js";

/** A block's markup, with how long its start and end tags are, to find what's inside it without parsing. */
export interface Markup {
  html: string;
  open: number;
  close: number;
}

export interface PendingChange {
  id: string;
  kind: "added" | "removed" | "changed" | "moved";
  tag: string;
  moved?: true; // a changed block the agent also moved
  before?: Markup; // the block before the agent's first change in this run of changes (not for added or moved)
  lead?: string; // removed: the line break and indentation it had in front of it
  place?: Place; // removed, moved: where it was
  after?: Markup; // the block right after the agent's latest change (left out when it's too large)
  afterPrint?: string; // a fingerprint of that markup
  tooLarge?: true; // the block was too large to keep, so it can only be kept
  since: string; // ISO time of the first change
}

/** What the page needs to show a pending change. */
export interface PendingSummary {
  id: string;
  kind: PendingChange["kind"];
  tag: string;
  moved?: true;
  before?: string; // its plain text before the change, for changed and removed blocks
  since: string;
  undoable: boolean;
}

/** An undo that doesn't fit the file any more, with a message for the user. */
export class CantUndo extends Error {}

/** How large a block's markup may be for its change to be undoable; larger ones can only be kept. */
const MARKUP_MAX = 50_000;
/** How many pending changes are kept; the oldest go first. */
const MAX = 300;

const digest = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);
const squash = (html: string) => html.replace(/\s+/g, " ").trim();
const inner = (m: Markup) => m.html.slice(m.open, m.html.length - m.close);
const tagOf = (m: Markup) => /^<([a-zA-Z][\w-]*)/.exec(m.html)?.[1].toLowerCase();
const samePlace = (a?: Place, b?: Place) => !!a && !!b && a.parent === b.parent && a.prev === b.prev && a.next === b.next;

/** Every element with an id, by id. */
function byId(source: string): Map<string, Node> {
  const found = new Map<string, Node>();
  const visit = (node: Node) => {
    for (const child of node.children) {
      const id = child.attrs.get(ID_ATTR);
      if (id !== undefined && !found.has(id)) found.set(id, child);
      visit(child);
    }
  };
  visit(parse(source));
  return found;
}

const markupOf = (source: string, node: Node): Markup => ({
  html: copyOf(source.slice(node.start, node.end)),
  open: node.openEnd - node.start,
  close: node.end - node.innerEnd,
});

export class PendingChanges {
  private items = new Map<string, PendingChange>();
  /** Goes up whenever the list changes. Starts above 0 when changes were saved, so the page asks for them. */
  revision = 0;

  /** `saved` is what toJSON gave earlier; changes to blocks that are no longer in `source` are dropped. */
  constructor(saved: string | null, source: string) {
    try {
      for (const p of JSON.parse(saved ?? "[]") as PendingChange[]) {
        if (typeof p?.id === "string" && ["added", "removed", "changed", "moved"].includes(p.kind)) this.items.set(p.id, p);
      }
    } catch {
      // nothing saved, or not readable
    }
    this.prune(byId(source));
    if (this.items.size) this.revision = 1;
  }

  get(id: string): PendingChange | undefined {
    return this.items.get(id);
  }

  get size(): number {
    return this.items.size;
  }

  /** Clear one change, or all of them. Returns true if anything was cleared. */
  clear(id?: string): boolean {
    const cleared = id === undefined ? this.items.size > 0 : this.items.has(id);
    if (id === undefined) this.items.clear();
    else this.items.delete(id);
    if (cleared) this.revision++;
    return cleared;
  }

  /**
   * Record what one write did: `changes` from diffBlocks(`was`, `now`). Only the agent's changes
   * become pending; anyone's write can end one, when the block it's about is removed (or, for a
   * removal, put back). Returns true if the list changed.
   */
  record(changes: BlockChange[], by: Author, was: string, now: string, at = new Date()): boolean {
    let touched = false;
    const after = byId(now);
    if (by.kind === "agent") {
      const before = byId(was);
      const refresh = new Set<string>(); // pending blocks to take the agent's latest markup of
      for (const c of changes) {
        // A change inside a block the agent added is part of the addition.
        const host = this.addedAround(c.kind === "removed" ? before.get(c.id) : after.get(c.id));
        if (host) {
          refresh.add(host);
          continue;
        }
        touched = true;
        const p = this.items.get(c.id);
        const node = before.get(c.id);
        if (!p) {
          const fresh: PendingChange = { id: c.id, kind: c.kind, tag: c.tag, since: at.toISOString() };
          if (c.kind === "changed" || c.kind === "removed") this.keepBefore(fresh, was, node!);
          if (c.kind === "removed") fresh.lead = copyOf(leadOf(was, c.id));
          if (c.place) fresh.place = c.place;
          this.items.set(c.id, fresh);
          if (c.kind !== "removed") refresh.add(c.id);
          continue;
        }
        p.tag = c.tag;
        if (p.kind === "added") {
          if (c.kind === "removed") this.items.delete(c.id);
          else refresh.add(c.id);
          continue;
        }
        if (c.kind === "removed") {
          p.place ??= c.place;
          if (!p.before && !p.tooLarge) this.keepBefore(p, was, node!);
          p.lead = copyOf(leadOf(was, c.id));
          p.kind = "removed";
          delete p.moved;
          delete p.after;
          delete p.afterPrint;
          continue;
        }
        if (c.kind === "added") {
          // Removed and put back: what's left to undo is how it differs from before.
          p.kind = "changed";
          delete p.lead;
          if (!samePlace(p.place, placeOf(now, c.id))) p.moved = true;
        } else if (c.kind === "changed" && p.kind === "moved") {
          p.kind = "changed";
          p.moved = true;
          this.keepBefore(p, was, node!);
        } else if (c.kind === "moved" && p.kind === "changed") {
          p.moved = true;
          p.place ??= c.place;
        }
        refresh.add(c.id);
      }
      for (const id of refresh) {
        const p = this.items.get(id);
        const node = after.get(id);
        if (!p || !node || p.kind === "removed") continue;
        this.keepAfter(p, now, node);
        touched = true;
        // The agent put it back the way it was: nothing left to review.
        const back = p.kind === "moved" ? samePlace(p.place, placeOf(now, id))
          : p.kind === "changed" && !p.moved && p.before ? squash(p.before.html) === squash(p.after?.html ?? "") : false;
        if (back) this.items.delete(id);
      }
    }
    if (this.prune(after)) touched = true;
    while (this.items.size > MAX) this.items.delete(this.items.keys().next().value!);
    if (touched) this.revision++;
    return touched;
  }

  /** The id of the closest block around `node` that the agent added and is still pending. */
  private addedAround(node: Node | undefined): string | undefined {
    for (let n = node?.parent; n; n = n.parent) {
      const id = n.attrs.get(ID_ATTR);
      if (id !== undefined && this.items.get(id)?.kind === "added") return id;
    }
    return undefined;
  }

  private keepBefore(p: PendingChange, source: string, node: Node): void {
    if (node.end - node.start > MARKUP_MAX) p.tooLarge = true;
    else p.before = markupOf(source, node);
  }

  private keepAfter(p: PendingChange, source: string, node: Node): void {
    p.afterPrint = digest(source.slice(node.start, node.end));
    if (node.end - node.start > MARKUP_MAX) delete p.after;
    else p.after = markupOf(source, node);
  }

  /** Drop changes to blocks that are gone, and removals of blocks that are back. */
  private prune(blocks: Map<string, Node>): boolean {
    let dropped = false;
    for (const [id, p] of this.items) {
      if ((p.kind === "removed") === blocks.has(id)) {
        this.items.delete(id);
        dropped = true;
      }
    }
    return dropped;
  }

  /** For the page, oldest first. */
  summary(): PendingSummary[] {
    return [...this.items.values()].map((p) => ({
      id: p.id, kind: p.kind, tag: p.tag, ...(p.moved ? { moved: true as const } : {}),
      ...(p.before && (p.kind === "changed" || p.kind === "removed") ? { before: plainText(inner(p.before)) } : {}),
      since: p.since,
      undoable: p.kind === "added" || p.kind === "moved" || !!p.before,
    }));
  }

  toJSON(): PendingChange[] {
    return [...this.items.values()];
  }
}

/** Where `id` can go back to, as the anchors to try in turn. */
function anchorsOf(place: Place | undefined): [string, "before" | "after"][] {
  return ([[place?.next, "before"], [place?.prev, "after"]] as const).filter(([a]) => a) as [string, "before" | "after"][];
}

/** `source` with the element moved back to `place`, or null if none of its old neighbours are left. */
function moveBack(source: string, id: string, place: Place | undefined): { text: string; where: string } | null {
  const inside = place?.parent ? ` (inside ${place.parent})` : "";
  for (const [anchor, position] of anchorsOf(place)) {
    try {
      return { text: moveBlock(source, id, anchor, position), where: `${position} ${anchor}${inside}` };
    } catch {
      // not a sibling any more, or can't be dragged: take it out and put it in next to the anchor
    }
    try {
      const node = findBlock(parse(source), id)!;
      const chunk = leadOf(source, id) + source.slice(node.start, node.end);
      return { text: putChunk(cutElement(source, id), chunk, anchor, position), where: `${position} ${anchor}${inside}` };
    } catch {
      // try the other neighbour
    }
  }
  return null;
}

/** The file with one pending change undone, and what that did, for the change line. */
export interface Reversal {
  text: string;
  from?: string; // changed: the block's inside before and after the undo
  to?: string;
  where?: string; // removed, moved: where it went back to
}

/**
 * The file with the agent's change undone. Throws CantUndo when that no longer fits the file.
 */
export function reverseChange(p: PendingChange, source: string): Reversal {
  const node = findBlock(parse(source), p.id);
  const gone = (why: string) => new CantUndo(`This can't be undone, because ${why}.`);
  if (p.kind === "removed") {
    if (node) throw gone("it's back in the document already");
    if (!p.before) throw gone("it's too large to keep a copy of");
    const chunk = (p.lead ?? "") + p.before.html;
    for (const [anchor, position] of anchorsOf(p.place)) {
      try {
        return { text: putChunk(source, chunk, anchor, position), where: `${position} ${anchor}${p.place?.parent ? ` (inside ${p.place.parent})` : ""}` };
      } catch {
        // try the other neighbour
      }
    }
    if (p.place?.parent) {
      try {
        return { text: putLast(source, chunk, p.place.parent), where: `inside ${p.place.parent}` };
      } catch {
        // the element it was in is gone too
      }
    }
    throw gone("the elements around it have changed");
  }
  if (!node) throw gone("it isn't in the document any more");
  const current = source.slice(node.start, node.end);
  if (p.kind === "added") {
    if (digest(current) !== p.afterPrint) throw gone("it has been changed since your agent added it. You can delete its text on the page instead");
    return { text: cutElement(source, p.id) };
  }
  if (p.kind === "moved") {
    const back = moveBack(source, p.id, p.place);
    if (!back) throw gone("the elements around it have changed");
    return back;
  }
  if (!p.before) throw gone("it's too large to keep a copy of");
  const now = source.slice(node.openEnd, node.innerEnd);
  let html: string;
  let to: string;
  if (digest(current) === p.afterPrint) {
    // Nothing has changed since the agent's latest change: put the old block back as it was.
    html = p.before.html;
    to = inner(p.before);
  } else {
    // Changed again since: undo the agent's words and keep the later ones.
    const merged = p.after ? mergeInner(inner(p.after), inner(p.before), now) : null;
    if (merged === null) throw gone("it has been changed again since, in the same words");
    // If the agent changed the tag and it's still the agent's, it goes back too.
    const retagged = !!p.after && tagOf(p.before) !== tagOf(p.after) && node.tag === tagOf(p.after);
    html = retagged
      ? p.before.html.slice(0, p.before.open) + merged + p.before.html.slice(p.before.html.length - p.before.close)
      : current.slice(0, node.openEnd - node.start) + merged + current.slice(node.innerEnd - node.start);
    to = merged;
  }
  let text = source.slice(0, node.start) + html + source.slice(node.end);
  let where: string | undefined;
  if (p.moved) {
    const back = moveBack(text, p.id, p.place);
    if (back) ({ text, where } = back);
  }
  return { text, from: now, to, ...(where ? { where } : {}) };
}
