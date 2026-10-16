// A short history of what changed in the document while inplace runs, for the
// page's change list. Changes are worked out per block by comparing the file
// before and after each write, so every way of changing it is covered the same
// way: typing on the page, an agent editing the file, or the MCP tools.

import { ID_ATTR, parse, type Node } from "./htmldoc.js";

export type Author = "you" | "agent";

/**
 * Where a block sits: the id of the nearest block around it ("" at the top),
 * and the elements with an id right before and after it in the same parent element.
 */
export interface Place {
  parent: string;
  prev?: string;
  next?: string;
}

export interface BlockChange {
  id: string;
  kind: "added" | "removed" | "changed" | "moved";
  tag: string;
  fromTag?: string; // set when the element's tag changed, e.g. p → h2
  before?: string; // plain text
  after?: string;
  place?: Place; // where a removed or moved block was before the change
}

export interface HistoryEntry {
  n: number;
  by: Author;
  started: string; // ISO time of the first change in the entry
  at: string; // ISO time of the latest
  changes: BlockChange[];
}

const TEXT_MAX = 600;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The readable text of some HTML, on one line. */
export function plainText(html: string): string {
  const text = html
    .replace(/<\/?(?:br|p|div|li|dt|dd|h[1-6]|t[rdh]|caption|figcaption|blockquote)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= TEXT_MAX ? text : text.slice(0, TEXT_MAX) + "…";
}

interface Block {
  tag: string;
  parent: string; // id of the nearest block around it, "" at the top
  own: string; // its content without the blocks nested in it, for comparing
  text: string;
  place: Place;
}

/** The nearest elements with an id inside `node`, not looking further into them. */
function nested(node: Node): Node[] {
  const found: Node[] = [];
  for (const child of node.children) {
    if (child.attrs.has(ID_ATTR)) found.push(child);
    else found.push(...nested(child));
  }
  return found;
}

/** Every block with an id, in document order, and the order of blocks within each parent. */
function blocksOf(source: string): { blocks: Map<string, Block>; order: Map<string, string[]> } {
  const blocks = new Map<string, Block>();
  const order = new Map<string, string[]>();
  const visit = (node: Node, parent: string) => {
    for (const child of nested(node)) {
      const id = child.attrs.get(ID_ATTR)!;
      if (blocks.has(id)) continue;
      let own = "";
      let at = child.openEnd;
      for (const inner of nested(child)) {
        own += source.slice(at, inner.start);
        at = inner.end;
      }
      own += source.slice(at, child.innerEnd);
      const siblings = child.parent!.children.filter((s) => s.attrs.has(ID_ATTR));
      const k = siblings.indexOf(child);
      const place: Place = { parent };
      if (k > 0) place.prev = siblings[k - 1].attrs.get(ID_ATTR)!;
      if (k < siblings.length - 1) place.next = siblings[k + 1].attrs.get(ID_ATTR)!;
      blocks.set(id, {
        tag: child.tag,
        parent,
        own: own.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim(),
        text: plainText(source.slice(child.openEnd, child.innerEnd)),
        place,
      });
      order.set(parent, [...(order.get(parent) ?? []), id]);
      visit(child, id);
    }
  };
  visit(parse(source), "");
  return { blocks, order };
}

/** Where the block with this id sits in the file, or undefined if it isn't there. */
export function placeOf(source: string, id: string): Place | undefined {
  return blocksOf(source).blocks.get(id)?.place;
}

/** Items of `a` that stay in place when `a` is reordered into `b` (a longest common subsequence). */
function stable(a: string[], b: string[]): Set<string> {
  const len = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      len[i][j] = a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  const keep = new Set<string>();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { keep.add(a[i]); i++; j++; }
    else if (len[i + 1][j] >= len[i][j + 1]) i++;
    else j++;
  }
  return keep;
}

/** What changed between two versions of the file, block by block. */
export function diffBlocks(beforeSource: string, afterSource: string): BlockChange[] {
  const before = blocksOf(beforeSource);
  const after = blocksOf(afterSource);
  const changes: BlockChange[] = [];
  const moved = new Set<string>();
  for (const [parent, ids] of after.order) {
    const was = (before.order.get(parent) ?? []).filter((id) => after.blocks.get(id)?.parent === parent);
    const now = ids.filter((id) => before.blocks.get(id)?.parent === parent);
    const keep = stable(was, now);
    for (const id of now) if (!keep.has(id)) moved.add(id);
  }
  for (const [id, b] of after.blocks) {
    const a = before.blocks.get(id);
    if (!a) {
      if (!after.blocks.has(b.parent) || before.blocks.has(b.parent))
        changes.push({ id, kind: "added", tag: b.tag, after: b.text });
    } else if (a.own !== b.own || a.tag !== b.tag) {
      changes.push({ id, kind: "changed", tag: b.tag, ...(a.tag !== b.tag ? { fromTag: a.tag } : {}), before: a.text, after: b.text });
    } else if (moved.has(id) || a.parent !== b.parent) {
      changes.push({ id, kind: "moved", tag: b.tag, after: b.text, place: a.place });
    }
  }
  for (const [id, a] of before.blocks) {
    if (!after.blocks.has(id) && (!before.blocks.has(a.parent) || after.blocks.has(a.parent)))
      changes.push({ id, kind: "removed", tag: a.tag, before: a.text, place: a.place });
  }
  return changes;
}

/** Fold a later change to the same block into an earlier one. Returns false if they cancel out. */
function fold(prev: BlockChange, next: BlockChange): boolean {
  // Where the block was before the first of them.
  if (!prev.place && next.place && prev.kind !== "added") prev.place = next.place;
  if (prev.kind === "added") {
    if (next.kind === "removed") return false;
    prev.tag = next.tag;
    prev.after = next.after ?? prev.after;
    return true;
  }
  if (next.kind === "removed") {
    prev.kind = "removed";
    prev.before ??= next.before;
    delete prev.after;
    delete prev.fromTag;
    return true;
  }
  if (next.kind === "changed" || prev.kind === "changed") {
    if (prev.kind === "moved") prev.before = prev.after;
    prev.kind = "changed";
    const from = prev.fromTag ?? (prev.tag !== next.tag ? prev.tag : undefined);
    if (from && from !== next.tag) prev.fromTag = from;
    else delete prev.fromTag;
  }
  prev.tag = next.tag;
  prev.after = next.after ?? prev.after;
  return !(prev.kind === "changed" && prev.before === prev.after && !prev.fromTag);
}

/**
 * The list of changes, newest last. Changes by the same author within
 * `windowMs` of each other go into one entry, so a burst of typing or an
 * agent's several quick edits read as one step.
 */
export class History {
  readonly entries: HistoryEntry[] = [];
  /** Goes up whenever the list changes, including when an entry grows. */
  revision = 0;
  private next = 1;

  constructor(readonly windowMs = 30_000, readonly max = 100) {}

  /** Returns true if the list changed. */
  add(by: Author, changes: BlockChange[], now = new Date()): boolean {
    if (!changes.length) return false;
    const last = this.entries.at(-1);
    if (last && last.by === by && now.getTime() - Date.parse(last.at) < this.windowMs) {
      for (const change of changes) {
        const i = last.changes.findIndex((c) => c.id === change.id);
        if (i === -1) last.changes.push({ ...change });
        else if (!fold(last.changes[i], change)) last.changes.splice(i, 1);
      }
      last.at = now.toISOString();
      if (!last.changes.length) this.entries.pop();
      this.revision++;
      return true;
    }
    this.entries.push({ n: this.next++, by, started: now.toISOString(), at: now.toISOString(), changes: changes.map((c) => ({ ...c })) });
    if (this.entries.length > this.max) this.entries.shift();
    this.revision++;
    return true;
  }
}
