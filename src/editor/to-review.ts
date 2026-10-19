// --- the agent's changes to review: Keep or Undo for each block it changed ---
// Always on. A bar in the margin marks each block with a change to review, and pointing at the
// block, or moving into it with the keyboard, shows Keep and Undo beside it. The list of changes
// has them all at the top. The server keeps the list, so nothing of this is in the file.
const reviewBars = make("div", { id: "inplace-pending-layer" });
reviewBars.dataset.inplaceUi = "";
const reviewActions = make("div", { id: "inplace-pending-actions", role: "group", ariaLabel: "Your agent's change" });
reviewActions.dataset.inplaceUi = "";
let actionsFor: HTMLElement | null = null;
let hideActionsTimer = 0;
const oldWordTips = new Set<Element>(); // blocks whose old words show on hover because of a change to review
const TOO_LARGE = "This block is too large to undo here. Ask your agent to change it back.";

// Declared as functions, so the bars in authors.ts can ask before this part has run.
function reviewOn() {
  return canEdit && !reviewing;
}
/** The change to review on a block that's in the page. */
function toReviewFor(id: string | undefined) {
  return id ? toReview.find((p) => p.id === id && p.kind !== "removed") : undefined;
}

/** "Edited paragraph", "New list item": the same words as the rest of the list of changes. */
function reviewWords(p: ToReview) {
  const words = describe({ id: p.id, kind: p.kind, tag: p.tag });
  return p.moved ? `${words}, moved` : words;
}

// "Your agent changed this paragraph. Keep the change or undo it."
function reviewSentence(p: ToReview) {
  return `Your agent ${p.kind} this ${noun(p.tag)}. Keep the change or undo it.`;
}

function paintToReview() {
  reviewBars.replaceChildren();
  for (const el of oldWordTips) {
    if (reviewOn() && toReviewFor((el as HTMLElement).dataset.id)) continue;
    const words = wordChanges.get(el);
    if (words) clearWords(el, words);
    rewritten.delete(el);
    oldWordTips.delete(el);
  }
  const shown = reviewOn() ? toReview.filter((p) => p.kind !== "removed") : [];
  if (actionsFor && !(reviewOn() && toReviewFor(actionsFor.dataset.id))) hideActions();
  if (!shown.length) return reviewBars.remove();
  if (!reviewBars.isConnected) document.body.append(reviewBars);
  const items: { el: HTMLElement; p: ToReview; colour: string }[] = [];
  for (const p of shown) {
    const el = byId(p.id);
    if (el && isShown(el)) items.push({ el, p, colour: "" });
  }
  for (const { el, p, css } of marginBars(items, barBlocks())) {
    const bar = make("div", { className: "bar", title: reviewSentence(p) });
    bar.style.cssText = css;
    bar.addEventListener("pointerenter", () => showActions(el));
    reviewBars.append(bar);
  }
  for (const { el, p } of items) {
    // Hovering a changed word shows the word it replaced, as it does right after the change,
    // but without the tint. A block rewritten as a whole shows its old text.
    if (p.kind === "changed" && p.before !== undefined && !wordChanges.has(el) && !rewritten.has(el)) {
      if (tintWords(el, p.before)) {
        // Keep the ranges for the tooltip, as once a tint has faded, but don't colour them.
        CSS.highlights.delete(wordChanges.get(el)!.name);
        el.classList.remove("inplace-changed-words");
      } else rememberRewritten(el, p.before);
      oldWordTips.add(el);
    }
  }
}

/** The innermost block around `target` with a change to review. */
function reviewBlockAt(target: EventTarget | null) {
  for (let el = (target as Element | null)?.closest?.<HTMLElement>("[data-id]"); el; el = el.parentElement?.closest<HTMLElement>("[data-id]")) {
    if (toReviewFor(el.dataset.id)) return el;
  }
  return null;
}

function showActions(el: HTMLElement) {
  const p = toReviewFor(el.dataset.id);
  if (!p || !reviewOn()) return;
  clearTimeout(hideActionsTimer);
  if (actionsFor === el && reviewActions.style.display === "flex") return;
  actionsFor = el;
  const what = `your agent's change to this ${noun(p.tag)}`;
  reviewActions.replaceChildren(
    make("button", { type: "button", textContent: "Keep", ariaLabel: `Keep ${what}`, title: "Keep this change", onclick: () => keepAgentChange(p.id) }),
    make("button", { type: "button", textContent: "Undo", ariaLabel: `Undo ${what}`, disabled: !p.undoable,
      title: p.undoable ? "Put back what was here before" : TOO_LARGE, onclick: () => undoAgentChange(p.id) }));
  if (!reviewActions.isConnected) document.body.append(reviewActions);
  reviewActions.style.display = "flex";
  // To the right of the block when there's room, otherwise just above its right end.
  const r = el.getBoundingClientRect(), w = reviewActions.offsetWidth, h = reviewActions.offsetHeight;
  const beside = r.right + 8 + w <= document.documentElement.clientWidth - 4;
  const left = beside ? r.right + 8 : Math.max(4, r.right - w);
  const top = beside ? r.top : r.top - h - 4 >= 0 ? r.top - h - 4 : r.bottom + 4;
  reviewActions.style.left = `${left + scrollX}px`;
  reviewActions.style.top = `${top + scrollY}px`;
}

function hideActions() {
  clearTimeout(hideActionsTimer);
  actionsFor = null;
  reviewActions.style.display = "none";
}

document.addEventListener("mouseover", (e) => {
  if (drag) return;
  const target = e.target as Element;
  if (reviewActions.contains(target) || reviewBars.contains(target)) return clearTimeout(hideActionsTimer);
  const el = reviewBlockAt(target);
  if (el) return showActions(el);
  if (actionsFor) {
    clearTimeout(hideActionsTimer);
    hideActionsTimer = setTimeout(hideActions, 400);
  }
});
document.addEventListener("focusin", (e) => {
  if (reviewActions.contains(e.target as Node)) return;
  const el = reviewBlockAt(e.target);
  if (el) showActions(el);
});

/** The changes to review at the top of the list of changes, in the order they are in the page. */
function toReviewGroup() {
  if (!reviewOn() || !toReview.length) return null;
  // Removed blocks aren't in the page, so they go last.
  const sorted = [...toReview].sort((a, b) => {
    const x = a.kind === "removed" ? null : byId(a.id), y = b.kind === "removed" ? null : byId(b.id);
    if (!x || !y) return x ? -1 : y ? 1 : 0;
    return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  const items = make("ul");
  for (const p of sorted) {
    const el = p.kind !== "removed" ? byId(p.id) : null;
    const change: BlockChange = { id: p.id, kind: p.kind, tag: p.tag, ...(p.before !== undefined ? { before: p.before } : {}),
      ...(el ? { after: flat(el.textContent || "") } : {}) };
    // For an edit, the changed words with a few around them, as in the rest of the list.
    const body = [make("span", { className: "kind", textContent: reviewWords(p) }),
      make("span", { className: "text" }, ...(p.kind === "changed" && p.before === undefined ? [clipText(change.after || "", 140)] : snippet(change)))];
    items.append(make("li", {},
      el ? make("button", { type: "button", className: "change", title: "Show in the document", onclick: () => goTo(el, change, "agent") }, ...body)
        : make("div", { className: "change" }, ...body),
      make("div", { className: "acts" },
        make("button", { type: "button", className: "act keep", textContent: "Keep", ariaLabel: `Keep: ${reviewWords(p)}`, onclick: () => keepAgentChange(p.id) }),
        make("button", { type: "button", className: "act", textContent: "Undo", ariaLabel: `Undo: ${reviewWords(p)}`, disabled: !p.undoable,
          title: p.undoable ? "" : TOO_LARGE, onclick: () => undoAgentChange(p.id) }))));
  }
  return make("div", { className: "to-review" },
    make("div", { className: "head" },
      make("h3", { textContent: `Your agent’s changes to review (${toReview.length})` }),
      make("button", { type: "button", className: "keep-all", textContent: "Keep all", onclick: () => keepAgentChange() })),
    items);
}
/** Keep one of the agent's changes, or all of them: they only leave the list. */
async function keepAgentChange(id?: string) {
  hideActions();
  const res = await post(id ? "suggestion/keep" : "suggestion/keep-all", id ? { id } : {});
  if (!res.ok) showStatus(res.body.error || "Couldn’t keep this change.", "error", 6000);
  await loadHistory();
}

/** Put back what the block was before the agent changed it, then reload to show the file as it is now. */
async function undoAgentChange(id: string) {
  hideActions();
  for (const unsaved of pending()) {
    const el = byId(unsaved);
    if (el && !(await save(el))) return;
  }
  const res = await post("suggestion/undo", { id });
  if (!res.ok) {
    showStatus(res.body.error || "Couldn’t undo this change.", "error", 8000);
    return loadHistory();
  }
  version = res.body.version;
  // Not marked as the agent's change after the reload: it's the user's own.
  reload([...document.querySelectorAll<HTMLElement>("[data-id]")].map((el) => el.dataset.id!).concat(id));
}

let reviewFrame = 0;
const repaintToReview = () => { cancelAnimationFrame(reviewFrame); reviewFrame = requestAnimationFrame(paintToReview); };
addEventListener("resize", repaintToReview);
addEventListener("load", repaintToReview);
if (typeof ResizeObserver === "function") new ResizeObserver(repaintToReview).observe(document.documentElement);
