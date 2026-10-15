// Find editable text blocks in an HTML file and patch them in place.
//
// The file on disk stays the source of truth. We never re-serialise the whole
// document: every change is a splice into the original text, so markup, CSS,
// SVG and formatting outside the edited block stay byte-for-byte identical.

import { parse as parseDocument, parseFragment } from "parse5";
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

/** Elements that appear in the source, with offsets. Parser-inserted ones (an implied <tbody>) are skipped. */
export function parse(source: string): Node {
  const doc = parseDocument(source, { sourceCodeLocationInfo: true });
  const root: Node = {
    tag: "#root", attrs: new Map(), start: 0, openEnd: 0, innerEnd: source.length, end: source.length,
    parent: null, children: [], hasText: false,
  };

  const visit = (from: ParentNode, into: Node) => {
    const kids: ChildNode[] = isElement(from) && from.tagName === "template"
      ? (from as DefaultTreeAdapterMap["template"]).content.childNodes
      : from.childNodes;
    for (const child of kids) {
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
        start: loc.startTag.startOffset,
        openEnd: loc.startTag.endOffset,
        innerEnd: loc.endTag ? loc.endTag.startOffset : loc.endOffset,
        end: loc.endOffset,
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

export function isEditableBlock(node: Node): boolean {
  return TEXT_CONTAINERS.has(node.tag) && !isLocked(node) && !containsBlock(node) && containsText(node);
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

/**
 * Give every editable block and container without an id a short, unique data-id.
 *
 * Existing ids are kept, so ids the agent or a comment already refers to never move.
 */
export function assignIds(source: string): { source: string; added: number } {
  const root = parse(source);
  const used = new Set<string>();
  for (const n of walk(root)) if (n.attrs.has(ID_ATTR)) used.add(n.attrs.get(ID_ATTR)!);
  const counters = new Map<string, number>();

  const nextId = (tag: string) => {
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

  const inserts: [number, string][] = [];
  for (const node of walk(root)) {
    if (!node.attrs.has(ID_ATTR) && (isEditableBlock(node) || isAnchor(node))) {
      inserts.push([node.start + 1 + node.tag.length, ` ${ID_ATTR}="${nextId(node.tag)}"`]);
    }
  }
  for (const [offset, text] of inserts.reverse()) {
    source = source.slice(0, offset) + text + source.slice(offset);
  }
  return { source, added: inserts.length };
}

export function findBlock(root: Node, blockId: string): Node | null {
  for (const node of walk(root)) if (node.attrs.get(ID_ATTR) === blockId) return node;
  return null;
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
  // Take the line break in front of the moved element with it, unless the
  // next element sits on the same line and needs that break.
  const start = /^[ \t]*(\n|<\/|$)/.test(source.slice(node.end)) ? chunkStart(source, node) : node.start;
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
