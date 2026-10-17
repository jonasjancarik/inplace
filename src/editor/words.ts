// --- changed words inside a paragraph ---
// Marked with the CSS Custom Highlight API, which colours text ranges without
// touching the page's HTML, so nothing extra ends up in what gets saved.
/** A paragraph whose changed words are highlighted. */
interface WordChange {
  before: string;
  ranges: Range[];
  changes: { range: Range; gone: string }[];
  by: "agent" | "you";
  name: string;
  rule: CSSStyleRule;
  done?: boolean;
}
const wordChanges = new WeakMap<Element, WordChange>();
const wordStyle = document.createElement("style");
wordStyle.dataset.inplaceUi = "";
document.head.append(wordStyle);
const WORD_TINT = [179, 156, 255, 0.42];
addEventListener("beforeprint", () => {
  for (const name of [...(window.CSS?.highlights?.keys() ?? [])]) if (name.startsWith("inplace-words-")) CSS.highlights.delete(name);
});
let wordCount = 0;

// Text ranges in `el` that differ from `before`, each with the words it
// replaced (`gone`, empty for an insertion), or null when the change is
// better shown on the whole block: nothing added, or most of it rewritten.
function changedRanges(el: Element, before: string) {
  const text = el.textContent!;
  const spans: [number, number, string][] = [];
  let at = 0, added = 0;
  for (const run of diffWords(before, text)) {
    const piece = (run.same || run.added).join("");
    if (!run.same && piece.trim()) {
      const lead = piece.length - piece.trimStart().length, trail = piece.length - piece.trimEnd().length;
      spans.push([at + lead, at + piece.length - trail, run.gone.join("").trim()]);
      added += piece.trim().length;
    }
    at += piece.length;
  }
  if (!spans.length || added > text.trim().length * 0.6) return null;
  // Turn text offsets into ranges over the element's text nodes.
  const nodes: [Text, number][] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null, pos = 0; n; n = walker.nextNode() as Text | null) {
    nodes.push([n, pos]);
    pos += n.data.length;
  }
  const point = (offset: number, end: boolean): [Text, number] | null => {
    for (let k = nodes.length - 1; k >= 0; k--) {
      const [n, pos] = nodes[k];
      if (end ? offset > pos : offset >= pos) return [n, Math.min(offset - pos, n.data.length)];
    }
    return null;
  };
  return spans.map(([from, to, gone]) => {
    const range = document.createRange();
    const start = point(from, false), end = point(to, true);
    if (!start || !end) return null;
    range.setStart(...start);
    range.setEnd(...end);
    return { range, gone };
  }).filter(Boolean) as WordChange["changes"];
}

// `by` says who made the change, for the tooltip on added words.
function tintWords(el: HTMLElement, before: string, by: "agent" | "you" = "agent") {
  if (!window.CSS?.highlights || !window.Highlight || !editable.has(el.dataset.id!)) return false;
  const changes = changedRanges(el, before);
  if (!changes?.length) return false;
  const ranges = changes.map((c) => c.range);
  const name = `inplace-words-${++wordCount}`;
  CSS.highlights.set(name, new Highlight(...ranges));
  const sheet = wordStyle.sheet!;
  const rule = sheet.cssRules[sheet.insertRule(`::highlight(${name}){background-color:rgba(${WORD_TINT.join(",")})}`, sheet.cssRules.length)] as CSSStyleRule;
  wordChanges.set(el, { before, ranges, changes, by, name, rule });
  el.classList.add("inplace-changed-words");
  return true;
}

// Keep the tint a moment, then fade it out, as the block tint does.
function fadeWords(words: WordChange) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hold = reduced ? 4400 : 1800, fade = reduced ? 0 : 2600;
  const start = performance.now() + hold;
  const step = (now: number) => {
    if (words.done) return;
    const t = Math.min(1, Math.max(0, (now - start) / (fade || 1)));
    const alpha = WORD_TINT[3] * (1 - t * t);
    words.rule.style.backgroundColor = `rgba(${WORD_TINT.slice(0, 3).join(",")},${alpha.toFixed(3)})`;
    if (t < 1) requestAnimationFrame(step);
    else CSS.highlights.delete(words.name);
  };
  requestAnimationFrame(step);
}

function clearWords(el: Element, words: WordChange) {
  words.done = true;
  CSS.highlights.delete(words.name);
  wordChanges.delete(el);
}
