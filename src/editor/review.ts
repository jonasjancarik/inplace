// --- review mode: every change since inplace started, shown in the page ---
// A read-only view: the old words are put into the page crossed out, so
// editing is paused while it's on, and leaving reloads the page.
const REVIEW_KEY = `${STATE_KEY}:review`; // "agent" or "all" while review mode is on
function reviewScope() {
  try { return sessionStorage.getItem(`${STATE_KEY}:review`); } catch { return null; } // also before REVIEW_KEY is set
}
let reviewing = false;
const reviewLayer = make("div", { id: "inplace-review-layer" });
reviewLayer.dataset.inplaceUi = "";

interface CombinedChange extends BlockChange {
  moved: boolean;
}

// Each block's changes in scope combined into one: its earliest text and
// place, and whether it was added, removed, moved or retagged on the way.
function combinedChanges(onlyAgent: boolean) {
  const out = new Map<string, CombinedChange>();
  for (const entry of historyEntries) {
    if (onlyAgent && entry.by.kind !== "agent") continue;
    for (const c of entry.changes) {
      const prev = out.get(c.id);
      if (!prev) {
        out.set(c.id, { ...c, before: c.kind === "moved" ? c.after : c.before, moved: c.kind === "moved" });
        continue;
      }
      if (prev.kind === "added") {
        if (c.kind === "removed") out.delete(c.id);
        else prev.tag = c.tag;
        continue;
      }
      if (c.kind === "removed") prev.kind = "removed";
      else if (c.kind === "added") prev.kind = "changed"; // removed and put back
      else if (prev.kind !== "removed") prev.kind = "changed";
      prev.moved ||= c.kind === "moved";
      prev.place ??= c.place;
      prev.fromTag ??= c.fromTag ?? (c.tag !== prev.tag ? prev.tag : undefined);
      prev.tag = c.tag;
    }
  }
  return out;
}

// The block's text nodes with their offsets, leaving out old words already
// put in.
function reviewTextNodes(el: Node) {
  const nodes: [Text, number][] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null, pos = 0; n; n = walker.nextNode() as Text | null) {
    if (n.parentElement!.closest(".inplace-del")) continue;
    nodes.push([n, pos]);
    pos += n.data.length;
  }
  return nodes;
}
// Split the text so a text node starts at `offset`; null at the very end.
function textAt(el: Node, offset: number) {
  for (const [n, pos] of reviewTextNodes(el)) {
    if (offset === pos && n.data.length) return n;
    if (offset > pos && offset < pos + n.data.length) return n.splitText(offset - pos);
  }
  return null;
}

// Put the words that went into the block crossed out and mark the new ones.
function markWords(el: HTMLElement, before: string) {
  let text = el.textContent!;
  // The history keeps the first 600 characters of a long block; leave the
  // part after that unmarked rather than mark all of it as new.
  const clipped = before.length > 600 && before.endsWith("…");
  if (clipped) before = before.slice(0, -1);
  if (flat(before) === flat(text)) return;
  const runs = diffWords(before, text);
  if (clipped && !runs.at(-1)!.same) runs.pop();
  const ops: { from: number; to: number; gone: string }[] = [];
  let at = 0;
  for (const run of runs) {
    if (run.same) { at += run.same.join("").length; continue; }
    const gone = run.gone.join(""), added = run.added.join("");
    const lead = added.length - added.trimStart().length;
    if (added.trim()) ops.push({ from: at + lead, to: at + added.trimEnd().length, gone: gone.trim() });
    else if (gone.trim()) ops.push({ from: at + lead, to: at + lead, gone: gone.trim() });
    at += added.length;
  }
  for (const { from, to, gone } of ops.reverse()) {
    let first: HTMLElement | null = null;
    if (to > from) {
      textAt(el, to);
      textAt(el, from);
      for (const [n, pos] of reviewTextNodes(el)) {
        if (pos < from || pos >= to || !n.data.length) continue;
        const ins = make("ins", { className: "inplace-ins" });
        ins.dataset.inplaceUi = "";
        n.before(ins);
        ins.append(n);
        first ??= ins;
      }
    }
    if (!gone) continue;
    const del = make("del", { className: "inplace-del", textContent: clipText(gone, 400) });
    del.dataset.inplaceUi = "";
    // The space between the old and new words isn't in the file either.
    const gap = make("span", { textContent: " " });
    gap.dataset.inplaceUi = "";
    const spot = first ?? textAt(el, from);
    if (spot) spot.before(del, gap);
    else el.append(gap, del);
  }
}

const article = (word: string) => (/^[aeiou]/.test(word) ? "an" : "a");
/** A label next to a block in review mode, with the block it belongs to. */
type ReviewLabel = HTMLSpanElement & { block: Element };
function reviewLabel(el: Element, lines: string[]) {
  const label = make("span", { className: "inplace-review-label" });
  for (const line of lines) label.append(make("span", { textContent: line }));
  reviewLayer.append(label);
  (label as ReviewLabel).block = el;
}
function placeLabels() {
  for (const label of reviewLayer.children as HTMLCollectionOf<ReviewLabel>) {
    const r = label.block.getBoundingClientRect();
    const w = label.offsetWidth;
    const left = r.left - w - 10;
    label.style.left = `${Math.max(4, left) + scrollX}px`;
    label.style.top = `${r.top + scrollY + (left < 4 ? -label.offsetHeight - 2 : 1)}px`;
  }
}

// The old text of a removed block, where the block used to be.
function ghost(change: CombinedChange) {
  const tag = (/^(li|dt|dd|tr)$/.test(change.tag) ? change.tag : "div") as "li" | "dt" | "dd" | "tr" | "div";
  const node = make(tag, { className: "inplace-ghost" });
  node.dataset.inplaceUi = "";
  node.dataset.ghost = change.id;
  const del = make("del", { className: "inplace-del", textContent: clipText(change.before || "", 400) });
  if (tag === "tr") node.append(make("td", { colSpan: 99 }, del));
  else node.append(del);
  return node;
}

async function enterReview(scope: string) {
  for (const id of pending()) {
    const el = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (el && !(await save(el))) return;
  }
  try { sessionStorage.setItem(REVIEW_KEY, scope); } catch {}
  reviewing = true;
  (document.activeElement as HTMLElement | null)?.blur?.();
  getSelection()!.removeAllRanges();
  for (const el of document.querySelectorAll<HTMLElement>("[data-id][contenteditable=true]")) el.contentEditable = "false";
  formatToolbar.style.display = "none";
  showGrips([]);
  hideTip();
  // The arrival highlights would mix with the marks.
  pill.style.display = "none";
  for (const el of document.querySelectorAll(".inplace-changed, .inplace-changed-fade, .inplace-changed-words"))
    el.classList.remove("inplace-changed", "inplace-changed-fade", "inplace-changed-words");
  for (const name of [...(window.CSS?.highlights?.keys() ?? [])]) if (name.startsWith("inplace-words-")) CSS.highlights.delete(name);
  document.documentElement.classList.add("inplace-reviewing");
  await loadHistory();

  const find = (id: string | undefined) => id && (document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) ||
    document.querySelector<HTMLElement>(`[data-ghost="${CSS.escape(id)}"]`));
  const leftOver: CombinedChange[] = [];
  for (const [id, change] of combinedChanges(scope === "agent")) {
    if (change.kind === "removed") {
      const prev = find(change.place?.prev), next = find(change.place?.next);
      if (prev) prev.after(ghost(change));
      else if (next && !change.place?.prev) next.before(ghost(change));
      else leftOver.push(change);
      continue;
    }
    const el = find(id);
    if (!el || el.dataset.ghost) continue;
    if (change.kind === "added") {
      el.classList.add("inplace-review-new");
      continue;
    }
    const lines: string[] = [];
    if (change.moved) lines.push("Moved here");
    if (change.fromTag && noun(change.fromTag) !== noun(change.tag))
      lines.push(`Was ${article(noun(change.fromTag))} ${noun(change.fromTag)}`);
    if (lines.length) reviewLabel(el, lines);
    if (change.before !== undefined && editable.has(id)) markWords(el, change.before);
  }

  const only: HTMLInputElement = make("input", { type: "checkbox", checked: scope === "agent", onchange: () => {
    try { sessionStorage.setItem(REVIEW_KEY, only.checked ? "agent" : "all"); } catch {}
    reloadAsIs();
  } });
  const bar = make("div", { id: "inplace-review-bar", role: "region", ariaLabel: "What changed" },
    make("span", { className: "what", textContent: "Showing what changed since inplace started. Editing is paused." }),
    make("label", {}, only, "Only the agent’s changes"),
    make("button", { type: "button", textContent: "Done", onclick: leaveReview }));
  bar.dataset.inplaceUi = "";
  if (leftOver.length) {
    bar.append(make("p", { className: "removed" }, "Also removed: ",
      ...leftOver.flatMap((c, i) => [i ? " " : "", make("del", { textContent: clipText(c.before || "", 160) })])));
  }
  const spacer = make("div", { id: "inplace-review-spacer" });
  spacer.dataset.inplaceUi = "";
  document.body.prepend(spacer);
  document.body.append(bar, reviewLayer);
  spacer.style.height = `${bar.offsetHeight}px`;
  placeLabels();
  if (changesPanel.classList.contains("open")) renderChanges();
}

// Reload keeping the scroll position and the open list, but without
// comparing blocks, which now hold the marks.
function reloadAsIs() {
  const spacer = document.getElementById("inplace-review-spacer");
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ x: scrollX, y: Math.max(0, scrollY - (spacer?.offsetHeight ?? 0)),
      changes: changesPanel.classList.contains("open") }));
  } catch {}
  location.reload();
}

function leaveReview() {
  try { sessionStorage.removeItem(REVIEW_KEY); } catch {}
  reloadAsIs();
}

function reviewSwitch() {
  return make("label", { className: "review-switch" },
    make("input", { type: "checkbox", role: "switch", checked: reviewing,
      onchange: (e) => ((e.target as HTMLInputElement).checked ? enterReview("agent") : leaveReview()) }),
    "Show what changed");
}

addEventListener("resize", () => { if (reviewing) placeLabels(); });
// Escape leaves review mode, once the list of changes is closed.
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && reviewing && !changesPanel.classList.contains("open") && !overlay.classList.contains("open")) leaveReview();
}, true);
if (reviewScope()) enterReview(reviewScope()!);
