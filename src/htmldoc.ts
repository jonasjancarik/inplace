// Find editable text blocks in an HTML file and patch them in place.
//
// The file on disk stays the source of truth. We never re-serialise the whole
// document: every change is a splice into the original text, so markup, CSS,
// SVG and formatting outside the edited block stay byte-for-byte identical.

import { parse as parseDocument, parseFragment, serialize } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

type ParentNode = DefaultTreeAdapterMap["parentNode"];
type ChildNode = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

export const ID_ATTR = "data-id";

// Elements that can hold a run of editable text.
const TEXT_CONTAINERS = new Set([
  "p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "figcaption",
  "caption", "dt", "dd", "blockquote", "div", "label",
]);

// Anything in here inside a candidate makes it a layout container, not a text block.
const BLOCK_TAGS = new Set([
  ...TEXT_CONTAINERS,
  "table", "thead", "tbody", "tfoot", "tr", "ul", "ol", "dl", "figure",
  "section", "article", "header", "footer", "nav", "aside", "main", "form",
  "svg", "canvas", "video", "audio", "iframe", "pre", "hr", "fieldset",
  // Buttons and form fields can't sit inside editable text: they'd be typed
  // over or deleted like characters.
  "button", "input", "select", "textarea",
]);

// Never editable, nor anything inside them.
const LOCKED_TAGS = new Set(["head", "script", "style", "svg", "nav", "template", "noscript", "pre", "textarea"]);

// Containers that get an id so a comment on them can be traced back to the
// file, but aren't edited as a whole (their text blocks are).
const ANCHOR_TAGS = new Set([
  "table", "tr", "ul", "ol", "dl", "figure", "svg", "section", "article",
  "aside", "blockquote", "div", "header", "footer", "li",
]);

// Nothing inside these gets an id at all.
const HIDDEN_TAGS = new Set(["head", "script", "style", "template", "noscript"]);

export interface Node {
  tag: string;
  attrs: Map<string, string>;
  start: number; // offset of "<"
  openEnd: number; // offset just after ">" of the start tag
  innerEnd: number; // offset where the content ends ("</" or the implicit close)
  end: number; // offset just after the end tag (or innerEnd if there is none)
  parent: Node | null;
  children: Node[];
  hasText: boolean; // non-whitespace text directly inside
}

function isElement(n: ChildNode | ParentNode): n is Element {
  return "tagName" in n;
}

// The last few documents parsed, newest last. A save parses the same text several times
// (to find the block, then to see what changed), and parsing a large file is slow.
const RECENT = 4;
const recent: { source: string; root: Node }[] = [];

/**
 * Elements that appear in the source, with offsets. Parser-inserted ones (an implied <tbody>) are skipped.
 *
 * Remembers the trees of recent sources and hands the same one back for the same text, so
 * callers must never change a tree.
 */
export function parse(source: string): Node {
  // Newest first: that's usually the one, and comparing with the others can take a while.
  const i = recent.findLastIndex((r) => r.source === source);
  if (i !== -1) {
    const [hit] = recent.splice(i, 1);
    recent.push(hit);
    return hit.root;
  }
  const root = parseTree(source);
  recent.push({ source, root });
  if (recent.length > RECENT) recent.shift();
  return root;
}

// Runs of plain characters this long, such as an image embedded as base64. parse5 reads an
// attribute value one character at a time, which makes a file with a large image slow to
// parse; when every run is inside an attribute value, they're left out while parsing.
// ("=" is left out so that a run never starts in an attribute's name: base64 only ends with it.)
const LONG_RUN = /[A-Za-z0-9+/]{1024}/g;
const RUN_END = /[^A-Za-z0-9+/]/g;

/** Where the long runs are, as [start, end) pairs. (A regex can't match one this long in one go.) */
function longRuns(source: string): [number, number][] {
  const runs: [number, number][] = [];
  LONG_RUN.lastIndex = 0;
  for (let m; (m = LONG_RUN.exec(source));) {
    RUN_END.lastIndex = m.index + m[0].length;
    const end = RUN_END.exec(source)?.index ?? source.length;
    runs.push([m.index, end]);
    LONG_RUN.lastIndex = end;
  }
  return runs;
}

type Document5 = DefaultTreeAdapterMap["document"];

const childrenOf = (from: ParentNode): ChildNode[] => isElement(from) && from.tagName === "template"
  ? (from as DefaultTreeAdapterMap["template"]).content.childNodes
  : from.childNodes;

/** Like parse, without remembering the tree. `skipLong: false` always parses every character, for tests. */
export function parseTree(source: string, skipLong = true): Node {
  const runs = skipLong ? longRuns(source) : [];
  const shortened = runs.length ? parseShortened(source, runs) : null;
  if (shortened) return shortened;
  return buildTree(source, parseDocument(source, { sourceCodeLocationInfo: true }), (offset) => offset);
}

/**
 * Parse with each long run cut down to its first character, then put the offsets and attribute
 * values back as the full source has them. Inside an attribute value these characters don't
 * change what the parser does, so the tree is the one the full source gives. Returns null when
 * a run is anywhere else (text, a script, an attribute name), or a value needed decoding.
 */
function parseShortened(source: string, runs: [number, number][]): Node | null {
  const at: number[] = []; // where each run starts in the shortened text
  const cut: number[] = []; // characters left out up to the end of each run
  const parts: string[] = [];
  let from = 0;
  let removed = 0;
  for (const [start, end] of runs) {
    parts.push(source.slice(from, start + 1));
    at.push(start - removed);
    removed += end - start - 1;
    cut.push(removed);
    from = end;
  }
  parts.push(source.slice(from));
  const short = parts.join("");
  // The first run starting at or after `offset` in the shortened text.
  const firstFrom = (offset: number) => {
    let lo = 0;
    let hi = at.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const back = (offset: number) => {
    const k = firstFrom(offset);
    return k ? offset + cut[k - 1] : offset;
  };

  const doc = parseDocument(short, { sourceCodeLocationInfo: true });
  let covered = 0;
  const check = (from: ParentNode): boolean => {
    for (const child of childrenOf(from)) {
      if (!isElement(child)) continue;
      const spans = child.sourceCodeLocation?.attrs;
      if (spans) {
        for (const attr of child.attrs) {
          const span = spans[attr.name];
          if (!span) continue;
          const k = firstFrom(span.startOffset);
          if (k === at.length || at[k] >= span.endOffset) continue;
          // The value starts after the first "=" (one can only come first in the name).
          const eq = short.indexOf("=", span.startOffset + 1);
          if (eq === -1 || eq >= span.endOffset) return false;
          let start = eq + 1;
          while (/\s/.test(short[start])) start++;
          const quoted = short[start] === '"' || short[start] === "'";
          if (quoted) start++;
          const end = quoted ? span.endOffset - 1 : span.endOffset;
          if (at[k] < start || short.slice(start, end) !== attr.value) return false;
          for (let j = k; j < at.length && at[j] < span.endOffset; j++) {
            if (at[j] >= end) return false;
            covered++;
          }
          attr.value = source.slice(back(start), back(end));
        }
      }
      if (!check(child)) return false;
    }
    return true;
  };
  if (!check(doc) || covered !== runs.length) return null;
  return buildTree(source, doc, back);
}

/** Our tree from parse5's, with `offset` turning parse5's offsets into offsets in `source`. */
function buildTree(source: string, doc: Document5, offset: (o: number) => number): Node {
  const root: Node = {
    tag: "#root", attrs: new Map(), start: 0, openEnd: 0, innerEnd: source.length, end: source.length,
    parent: null, children: [], hasText: false,
  };

  const visit = (from: ParentNode, into: Node) => {
    for (const child of childrenOf(from)) {
      if (child.nodeName === "#text") {
        if ((child as DefaultTreeAdapterMap["textNode"]).value.trim()) into.hasText = true;
        continue;
      }
      if (!isElement(child)) continue;
      const loc = child.sourceCodeLocation;
      if (!loc?.startTag) {
        visit(child, into); // implied by the parser: keep its children, skip the element
        continue;
      }
      const node: Node = {
        tag: child.tagName,
        attrs: new Map(child.attrs.map((a) => [a.name, a.value])),
        start: offset(loc.startTag.startOffset),
        openEnd: offset(loc.startTag.endOffset),
        innerEnd: offset(loc.endTag ? loc.endTag.startOffset : loc.endOffset),
        end: offset(loc.endOffset),
        parent: into,
        children: [],
        hasText: false,
      };
      into.children.push(node);
      visit(child, node);
    }
  };
  visit(doc, root);
  return root;
}

function* walk(node: Node): Generator<Node> {
  for (const child of node.children) {
    yield child;
    yield* walk(child);
  }
}

function isLocked(node: Node): boolean {
  for (let n: Node | null = node; n; n = n.parent) {
    if (LOCKED_TAGS.has(n.tag)) return true;
    if (n.attrs.has("data-locked") || n.attrs.get("contenteditable") === "false") return true;
  }
  return false;
}

function containsText(node: Node): boolean {
  return node.hasText || node.children.some((c) => !LOCKED_TAGS.has(c.tag) && containsText(c));
}

function containsBlock(node: Node): boolean {
  for (const d of walk(node)) if (BLOCK_TAGS.has(d.tag)) return true;
  return false;
}

// Blocks that stay editable when empty, so a new paragraph, item or cell can be typed into.
const MAY_BE_EMPTY = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "dt", "dd"]);

const isEmptyBlock = (node: Node) =>
  MAY_BE_EMPTY.has(node.tag) && !node.hasText && node.children.every((c) => c.tag === "br");

export function isEditableBlock(node: Node): boolean {
  return TEXT_CONTAINERS.has(node.tag) && !isLocked(node) && !containsBlock(node) &&
    (containsText(node) || isEmptyBlock(node));
}

export function editableBlocks(root: Node): Node[] {
  return [...walk(root)].filter(isEditableBlock);
}

export function isAnchor(node: Node): boolean {
  if (!ANCHOR_TAGS.has(node.tag) || isEditableBlock(node)) return false;
  for (let n = node.parent; n; n = n.parent) {
    if (HIDDEN_TAGS.has(n.tag) || n.tag === "svg") return false;
  }
  return true;
}

/** Ids of the blocks whose text may be edited in the browser. */
export function editableIds(source: string): string[] {
  return editableBlocks(parse(source)).flatMap((n) => (n.attrs.has(ID_ATTR) ? [n.attrs.get(ID_ATTR)!] : []));
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " " };

/**
 * A short hash of a block's inner HTML that a browser's `innerHTML` of the same
 * content hashes to as well: entities decoded and runs of space collapsed, so
 * the browser's and parse5's ways of writing them out don't matter. The editor
 * has a copy of this; the two must stay the same.
 */
export function contentHash(html: string): string {
  const text = html.replace(/&(amp|lt|gt|quot|nbsp);/g, (_, e: string) => ENTITIES[e]).replace(/\s+/g, " ").trim();
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * The content hash of each editable block as the file has it, so the page can
 * tell which blocks its own scripts have changed. Null when the document has
 * no scripts, since then nothing but the user changes the page.
 */
export function blockHashes(source: string): Record<string, string> | null {
  const ids = new Set(editableIds(source));
  const hashes: Record<string, string> = {};
  let scripted = false;
  const visit = (from: ParentNode) => {
    for (const child of from.childNodes) {
      if (!isElement(child)) continue;
      if (child.tagName === "script" || child.attrs.some((a) => a.name.startsWith("on"))) scripted = true;
      const id = child.attrs.find((a) => a.name === ID_ATTR)?.value;
      if (id !== undefined && ids.has(id)) hashes[id] = contentHash(serialize(child));
      visit(child);
    }
  };
  visit(parseDocument(source));
  return scripted ? hashes : null;
}

/**
 * Give every editable block and container without an id a short, unique data-id.
 *
 * Existing ids are kept, so ids the agent or a comment already refers to never move.
 */
/** Hands out `tag-N` ids that aren't used anywhere in the document yet. */
function idMaker(root: Node): (tag: string) => string {
  const used = new Set<string>();
  for (const n of walk(root)) if (n.attrs.has(ID_ATTR)) used.add(n.attrs.get(ID_ATTR)!);
  const counters = new Map<string, number>();
  return (tag: string) => {
    let n = counters.get(tag) ?? 0;
    for (;;) {
      n += 1;
      const candidate = `${tag}-${n}`;
      if (!used.has(candidate)) {
        counters.set(tag, n);
        used.add(candidate);
        return candidate;
      }
    }
  };
}

export function assignIds(source: string): { source: string; added: number } {
  const root = parse(source);
  const nextId = idMaker(root);

  const inserts: [number, string][] = [];
  for (const node of walk(root)) {
    if (!node.attrs.has(ID_ATTR) && (isEditableBlock(node) || isAnchor(node))) {
      inserts.push([node.start + 1 + node.tag.length, ` ${ID_ATTR}="${nextId(node.tag)}"`]);
    }
  }
  if (!inserts.length) return { source, added: 0 };
  // One pass rather than a splice per id, which is slow when a large file needs thousands.
  const parts: string[] = [];
  let at = 0;
  for (const [offset, text] of inserts) {
    parts.push(source.slice(at, offset), text);
    at = offset;
  }
  parts.push(source.slice(at));
  return { source: parts.join(""), added: inserts.length };
}

export function findBlock(root: Node, blockId: string): Node | null {
  for (const node of walk(root)) if (node.attrs.get(ID_ATTR) === blockId) return node;
  return null;
}

/** The text inside the element with this id, as the browser's textContent gives it, or null if there's no such element. */
export function elementText(source: string, id: string): string | null {
  const find = (from: ParentNode): Element | null => {
    for (const child of from.childNodes) {
      if (!isElement(child)) continue;
      if (child.attrs.some((a) => a.name === ID_ATTR && a.value === id)) return child;
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const textOf = (node: ParentNode): string => node.childNodes.map((c) =>
    c.nodeName === "#text" ? (c as DefaultTreeAdapterMap["textNode"]).value : isElement(c) ? textOf(c) : "").join("");
  const element = find(parseDocument(source));
  return element ? textOf(element) : null;
}

type Token = string;

/**
 * Normalise an HTML fragment so source text and browser innerHTML compare equal.
 *
 * Browsers re-serialise entities, quoting, void tags and whitespace; none of
 * that should count as a change.
 */
export function canonical(fragment: string): Token[] {
  const tokens: Token[] = [];
  let text = "";
  const flush = () => {
    const t = text.replace(/ /g, " ").split(/\s+/).filter(Boolean).join(" ");
    if (t) tokens.push(`t:${t}`);
    text = "";
  };
  const visit = (parent: ParentNode) => {
    for (const child of parent.childNodes) {
      if (child.nodeName === "#text") {
        text += (child as DefaultTreeAdapterMap["textNode"]).value;
      } else if (isElement(child)) {
        flush();
        const attrs = child.attrs.map((a) => `${a.name}=${a.value}`).sort().join(" ");
        tokens.push(`s:${child.tagName} ${attrs}`);
        visit(child);
        flush();
        tokens.push(`e:${child.tagName}`);
      }
    }
  };
  visit(parseFragment(fragment));
  flush();
  return tokens;
}

const sameContent = (a: string, b: string) => canonical(a).join("\n") === canonical(b).join("\n");

export class BlockNotFound extends Error {
  constructor(id: string) {
    super(`block not found: ${id}`);
  }
}

export class BlockConflict extends Error {
  constructor(public current: string) {
    super("block changed on disk");
  }
}

/**
 * Replace the inner HTML of one block, if nobody else changed it meanwhile.
 *
 * `oldInner` is what the browser showed before the edit. If the block on disk
 * no longer matches it (the agent edited the same block), throw BlockConflict
 * rather than overwrite the agent's text.
 */
export function patchBlock(source: string, blockId: string, oldInner: string, newInner: string): string {
  const node = findBlock(parse(source), blockId);
  if (!node || !isEditableBlock(node)) throw new BlockNotFound(blockId);
  const current = source.slice(node.openEnd, node.innerEnd);
  if (sameContent(current, newInner)) return source;
  if (!sameContent(current, oldInner)) throw new BlockConflict(current);
  return source.slice(0, node.openEnd) + newInner + source.slice(node.innerEnd);
}

// Elements whose position is part of the structure around them (a cell's
// column, a table's sections, a figure's caption) and so can't be dragged.
const UNMOVABLE_TAGS = new Set([
  "html", "head", "body", "td", "th", "thead", "tbody", "tfoot", "caption", "figcaption", "colgroup", "col",
]);

function canMove(node: Node): boolean {
  return node.attrs.has(ID_ATTR) && !UNMOVABLE_TAGS.has(node.tag) && !!node.parent && !isLocked(node);
}

/** Ids of the elements that can be dragged to another place among their siblings. */
export function movableIds(source: string): string[] {
  const ids: string[] = [];
  for (const node of walk(parse(source))) {
    if (canMove(node) && node.parent!.children.some((s) => s !== node && canMove(s))) {
      ids.push(node.attrs.get(ID_ATTR)!);
    }
  }
  return ids;
}

/**
 * Where an element's text starts once the indentation in front of it is
 * included, so a moved element keeps its own line and indentation.
 */
function chunkStart(source: string, node: Node): number {
  const siblings = node.parent!.children;
  const prev = siblings[siblings.indexOf(node) - 1];
  const from = prev ? prev.end : node.parent!.openEnd;
  const gap = source.slice(from, node.start);
  const newline = gap.lastIndexOf("\n");
  if (newline === -1 || gap.slice(newline + 1).trim()) return node.start;
  return from + newline;
}

/**
 * Where to start cutting an element out: with the line break in front of it,
 * unless the next element sits on the same line and needs that break.
 */
function cutStart(source: string, node: Node): number {
  return /^[ \t]*(\n|<\/|$)/.test(source.slice(node.end)) ? chunkStart(source, node) : node.start;
}

/**
 * Move one element before or after a sibling, keeping its markup unchanged.
 *
 * Both elements must still share a parent in the file; if the agent has
 * restructured that part in the meantime, throw BlockConflict.
 */
export function moveBlock(source: string, blockId: string, targetId: string, position: "before" | "after"): string {
  const root = parse(source);
  const node = findBlock(root, blockId);
  const target = findBlock(root, targetId);
  if (!node || !canMove(node)) throw new BlockNotFound(blockId);
  if (!target || !canMove(target)) throw new BlockNotFound(targetId);
  if (node === target || node.parent !== target.parent) throw new BlockConflict("");
  // The moved element takes on the line break and indentation of the target,
  // so it fits in whether its old neighbours were on separate lines or not.
  const start = cutStart(source, node);
  const targetStart = chunkStart(source, target);
  const at = position === "before" ? targetStart : target.end;
  const chunk = source.slice(targetStart, target.start) + source.slice(node.start, node.end);
  if (at >= node.end) return source.slice(0, start) + source.slice(node.end, at) + chunk + source.slice(at);
  return source.slice(0, at) + chunk + source.slice(at, start) + source.slice(node.end);
}

// Text blocks the page can switch between paragraph and heading.
export const RETAG_TAGS = new Set(["p", "h1", "h2", "h3", "h4"]);

/** Turn a paragraph into a heading or back, keeping its attributes and content. */
export function retagBlock(source: string, blockId: string, from: string, to: string): string {
  const node = findBlock(parse(source), blockId);
  if (!node || !isEditableBlock(node) || !RETAG_TAGS.has(to)) throw new BlockNotFound(blockId);
  if (node.tag !== from) throw new BlockConflict(source.slice(node.openEnd, node.innerEnd));
  if (from === to) return source;
  const hasEndTag = node.end !== node.innerEnd;
  const close = hasEndTag
    ? `</${to}` + source.slice(node.innerEnd + 2 + from.length, node.end)
    : `</${to}>`;
  return (
    source.slice(0, node.start + 1) + to + source.slice(node.start + 1 + from.length, node.innerEnd) +
    close + source.slice(node.end)
  );
}

// Elements a new sibling can be added next to from the page.
const INSERTABLE_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "dt", "dd"]);
const HEADING = /^h[1-6]$/;
const ID_ATTR_RE = /\s+data-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;

/** The start tag of an element as written in the file, without its data-id. */
const openTag = (source: string, node: Node) => source.slice(node.start, node.openEnd).replace(ID_ATTR_RE, "");
const withId = (open: string, tag: string, id: string) =>
  open.slice(0, 1 + tag.length) + ` ${ID_ATTR}="${id}"` + open.slice(1 + tag.length);

/**
 * The sibling a new `tag` element should copy: the most common way that tag
 * is written among its siblings, so a one-off such as a lead paragraph or a
 * totals row isn't repeated. On a tie, the element the user is at wins.
 */
function patternFor(source: string, near: Node, tag: string): Node | null {
  const same = near.parent!.children.filter((c) => c.tag === tag && !isLocked(c));
  if (!same.length) return null;
  const sig = (n: Node) => openTag(source, n).slice(1 + tag.length).trim();
  const counts = new Map<string, number>();
  for (const c of same) counts.set(sig(c), (counts.get(sig(c)) ?? 0) + 1);
  const max = Math.max(...counts.values());
  if (near.tag === tag && counts.get(sig(near)) === max) return near;
  return same.find((c) => counts.get(sig(c)) === max)!;
}

/** An empty copy of an element: the same start tags, cells and nested blocks, no text. */
function skeleton(source: string, node: Node, nextId: (tag: string) => string, content: string): string {
  const kids = node.children.filter((c) => TEXT_CONTAINERS.has(c.tag) || c.tag === "tr");
  if (kids.length && content) throw new BlockNotFound(node.attrs.get(ID_ATTR) ?? node.tag);
  const inner = kids.length ? kids.map((k) => skeleton(source, k, nextId, "")).join("") : content;
  return withId(openTag(source, node), node.tag, nextId(node.tag)) + inner + `</${node.tag}>`;
}

export interface Inserted {
  source: string;
  id: string; // id of the new element
  html: string; // the new element as written to the file
}

/**
 * Add a new element before or after `blockId`, modelled on its siblings.
 *
 * `tag` is the element's own tag, or "p" next to a heading. `content` fills a
 * new text block (when a paragraph is split in two). With `split`, the
 * original block is patched first, in the same write, so splitting a
 * paragraph never loses the second half.
 */
export function insertBlock(
  source: string, blockId: string, position: "before" | "after", tag: string, content = "",
  split?: { old: string; new: string },
): Inserted {
  if (split) source = patchBlock(source, blockId, split.old, split.new);
  const root = parse(source);
  const node = findBlock(root, blockId);
  if (!node || !node.parent || isLocked(node) || !INSERTABLE_TAGS.has(node.tag)) throw new BlockNotFound(blockId);
  if (tag !== node.tag && !(tag === "p" && HEADING.test(node.tag))) throw new BlockNotFound(blockId);
  const nextId = idMaker(root);
  const pattern = patternFor(source, node, tag);
  const html = pattern
    ? skeleton(source, pattern, nextId, content)
    : `<${tag} ${ID_ATTR}="${nextId(tag)}">${content}</${tag}>`;
  const lead = source.slice(chunkStart(source, node), node.start);
  const at = position === "before" ? chunkStart(source, node) : node.end;
  return {
    source: source.slice(0, at) + lead + html + source.slice(at),
    id: /data-id="([^"]+)"/.exec(html)![1],
    html,
  };
}

const EMBEDDED = /<(img|svg|video|audio|iframe|canvas|input|object|embed|picture|hr)\b/i;

/** True when an element has no visible content: no text, images or charts. */
function isBlank(source: string, node: Node): boolean {
  const inner = source.slice(node.openEnd, node.innerEnd);
  return !EMBEDDED.test(inner) && !inner.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;|\s/g, "");
}

/**
 * Remove an element the user emptied (a paragraph, item or row with no text
 * left). Anything with content is refused, so nothing can be lost this way.
 */
export function removeBlock(source: string, blockId: string): string {
  const node = findBlock(parse(source), blockId);
  if (!node || !canMove(node)) throw new BlockNotFound(blockId);
  if (!isBlank(source, node)) throw new BlockConflict(source.slice(node.openEnd, node.innerEnd));
  return source.slice(0, cutStart(source, node)) + source.slice(node.end);
}

/** The element's markup as removeBlock cuts it out, with the line break and indentation in front of it. */
export function cutChunk(source: string, blockId: string): string {
  const node = findBlock(parse(source), blockId);
  if (!node || !canMove(node)) throw new BlockNotFound(blockId);
  return source.slice(cutStart(source, node), node.end);
}

/** Take an element out whatever it holds, with the line break in front of it, as removeBlock does. */
export function cutElement(source: string, blockId: string): string {
  const node = findBlock(parse(source), blockId);
  if (!node || !node.parent) throw new BlockNotFound(blockId);
  return source.slice(0, cutStart(source, node)) + source.slice(node.end);
}

/** The line break and indentation cutElement takes out in front of an element. */
export function leadOf(source: string, blockId: string): string {
  const node = findBlock(parse(source), blockId);
  if (!node || !node.parent) throw new BlockNotFound(blockId);
  return source.slice(cutStart(source, node), node.start);
}

/** Put markup in as the last thing inside the element with `parentId`. */
export function putLast(source: string, chunk: string, parentId: string): string {
  const parent = findBlock(parse(source), parentId);
  if (!parent) throw new BlockNotFound(parentId);
  return source.slice(0, parent.innerEnd) + chunk + source.slice(parent.innerEnd);
}

/** Put markup cut out with cutChunk back in, right before or after the element with `anchorId`. */
export function putChunk(source: string, chunk: string, anchorId: string, position: "before" | "after"): string {
  const anchor = findBlock(parse(source), anchorId);
  if (!anchor || !anchor.parent) throw new BlockNotFound(anchorId);
  const at = position === "before" ? chunkStart(source, anchor) : anchor.end;
  return source.slice(0, at) + chunk + source.slice(at);
}

/**
 * Replace the inside (`part: "inner"`) or the whole (`"outer"`) of the element
 * with this id, if it still matches `expected`, for agents that edit through
 * tools rather than the file. A replacement element keeps the id: it's added
 * when the new start tag has none, and a different one is refused.
 */
export function replaceElement(
  source: string, id: string, part: "inner" | "outer", expected: string, html: string,
): string {
  const node = findBlock(parse(source), id);
  if (!node) throw new BlockNotFound(id);
  const [from, to] = part === "inner" ? [node.openEnd, node.innerEnd] : [node.start, node.end];
  const current = source.slice(from, to);
  if (!sameContent(current, expected)) throw new BlockConflict(current);
  if (part === "outer") {
    const tag = /^\s*<([a-zA-Z][\w-]*)([^>]*)>/.exec(html);
    if (!tag) throw new Error("the new HTML must start with an element");
    const given = /\sdata-id\s*=\s*["']?([^"'\s>]+)/.exec(tag[2])?.[1];
    if (given && given !== id) throw new Error(`the new element has data-id="${given}"; keep data-id="${id}"`);
    if (!given) {
      const at = tag.index + tag[0].indexOf(tag[1]) + tag[1].length;
      html = html.slice(0, at) + ` ${ID_ATTR}="${id}"` + html.slice(at);
    }
  }
  return source.slice(0, from) + html + source.slice(to);
}
