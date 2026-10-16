// Combine the user's edit to a block with a change someone else made to the
// same block in the meantime, when the two touch different words.

import { parseFragment } from "parse5";

interface Token {
  raw: string; // as written on its side
  key: string; // what it means, for comparing across the file and the browser
}

// Words, runs of white space, and tags. A non-breaking space counts as white space,
// since browsers write one where the file has a plain space and the other way round.
const TOKEN = /<!--[\s\S]*?-->|<[^>]*>|(?:\s|&nbsp;|&#160;| )+|(?:(?!&nbsp;|&#160;)[^\s< ])+/g;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

function decode(text: string): string {
  if (!text.includes("&")) return text;
  const node = parseFragment(text).childNodes[0] as { value?: string } | undefined;
  return node?.value ?? text;
}

function tagKey(raw: string): string {
  if (raw.startsWith("<!--")) return raw;
  const m = /^<(\/?)([a-zA-Z][\w-]*)([\s\S]*?)\/?>$/.exec(raw);
  if (!m) return raw;
  const attrs = [...m[3].matchAll(/([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)]
    .map(([, name, value = ""]) => `${name.toLowerCase()}=${decode(value.replace(/^["']|["']$/g, ""))}`)
    .sort();
  return `${m[1] ? "e" : "s"}:${m[2].toLowerCase()} ${attrs.join(" ")}`;
}

function tokenize(html: string): Token[] {
  return (html.match(TOKEN) ?? []).map((raw) => ({
    raw,
    key: raw.startsWith("<") ? tagKey(raw) : /^(?:\s|&nbsp;|&#160;| )+$/.test(raw) ? " " : "w:" + decode(raw),
  }));
}

interface Hunk {
  start: number; // range of base tokens replaced
  end: number;
  insert: Token[];
}

/**
 * The changes that turn `base` into `other`, from a longest common subsequence,
 * and which token of `other` each unchanged base token is. Null when the block
 * is too long to compare quickly.
 */
function diff(base: Token[], other: Token[]): { hunks: Hunk[]; match: number[] } | null {
  const n = base.length, m = other.length;
  if ((n + 1) * (m + 1) > 4_000_000) return null;
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = base[i].key === other[j].key
        ? lcs[(i + 1) * w + j + 1] + 1
        : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  const match: number[] = new Array(n).fill(-1);
  let i = 0, j = 0, open: Hunk | null = null;
  while (i < n || j < m) {
    if (i < n && j < m && base[i].key === other[j].key) {
      match[i] = j;
      open = null;
      i++; j++;
    } else {
      if (!open) hunks.push((open = { start: i, end: i, insert: [] }));
      if (j < m && (i === n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) open.insert.push(other[j++]);
      else open.end = ++i;
    }
  }
  return { hunks, match };
}

const sameInsert = (a: Hunk, b: Hunk) =>
  a.start === b.start && a.end === b.end && a.insert.map((t) => t.key).join() === b.insert.map((t) => t.key).join();

function balanced(tokens: string[]): boolean {
  const stack: string[] = [];
  for (const raw of tokens) {
    const m = /^<(\/?)([a-zA-Z][\w-]*)/.exec(raw);
    if (!m || VOID.has(m[2].toLowerCase()) || raw.endsWith("/>")) continue;
    const tag = m[2].toLowerCase();
    if (!m[1]) stack.push(tag);
    else if (stack.pop() !== tag) return false;
  }
  return stack.length === 0;
}

/**
 * Three-way merge of a block's inner HTML: `base` is what the user started from,
 * `mine` what they have now, `theirs` what the file has now. Returns the merged
 * HTML, or null when both sides changed the same or neighbouring words. Parts
 * only the file changed keep the file's own spelling of the markup.
 */
export function mergeInner(base: string, mine: string, theirs: string): string | null {
  const b = tokenize(base), m = tokenize(mine), t = tokenize(theirs);
  const ours = diff(b, m), other = diff(b, t);
  if (!ours || !other) return null;
  const hunks: (Hunk & { side: "mine" | "theirs" })[] = [];
  for (const h of ours.hunks) hunks.push({ ...h, side: "mine" });
  for (const h of other.hunks) {
    // Edits with no unchanged word between them clash, even if they don't overlap.
    const near = (o: Hunk) => {
      const [from, to] = o.end <= h.start ? [o.end, h.start] : [h.end, o.start];
      return from <= to && b.slice(from, to).every((tok) => tok.key === " ");
    };
    const clash = ours.hunks.find((o) => (o.start <= h.end && h.start <= o.end) || near(o));
    if (!clash) hunks.push({ ...h, side: "theirs" });
    else if (!sameInsert(clash, h)) return null;
  }
  hunks.sort((x, y) => x.start - y.start || x.end - y.end);

  const out: string[] = [];
  let i = 0;
  for (const h of hunks) {
    for (; i < h.start; i++) out.push(t[other.match[i]].raw);
    out.push(...h.insert.map((tok) => tok.raw));
    i = h.end;
  }
  for (; i < b.length; i++) out.push(t[other.match[i]].raw);
  return balanced(out) ? out.join("") : null;
}
