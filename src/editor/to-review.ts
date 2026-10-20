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
// With the caret in a block with a change to review. Alt and Shift with a letter types nothing on
// Windows and Linux, and is no browser's shortcut; on a Mac it would type a symbol, which this replaces.
const KEEP_SHORTCUT = MOD === "⌘" ? "⌥⇧K" : "Alt+Shift+K";
const UNDO_SHORTCUT = MOD === "⌘" ? "⌥⇧U" : "Alt+Shift+U";
const ANNOUNCE_KEY = `${STATE_KEY}:announce`;
let copyLeft: { id: string; why: string }[] | null = null; // changes the last copy without them still had

// What happened, for screen readers: a polite live region nobody sees.
const announcer = make("div", { id: "inplace-announce", role: "status" });
announcer.dataset.inplaceUi = "";
document.body.append(announcer);
function announce(text: string) {
  announcer.textContent = "";
  setTimeout(() => (announcer.textContent = text), 50);
}
// An undo reloads the page, so what it did is said once the new page is up.
try {
  const said = sessionStorage.getItem(ANNOUNCE_KEY);
  sessionStorage.removeItem(ANNOUNCE_KEY);
  if (said) setTimeout(() => announce(said), 300);
} catch {}

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
    const bar = make("div", { className: "bar", title: p.reason ? `${reviewSentence(p)}\nWhy: ${p.reason}` : reviewSentence(p) });
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
    make("button", { type: "button", textContent: "Keep", ariaLabel: `Keep ${what}`, title: `Keep this change (${KEEP_SHORTCUT})`,
      ariaKeyShortcuts: "Alt+Shift+K", onclick: () => keepAgentChange(p.id) }),
    make("button", { type: "button", textContent: "Undo", ariaLabel: `Undo ${what}`, disabled: !p.undoable,
      title: p.undoable ? `Put back what was here before (${UNDO_SHORTCUT})` : TOO_LARGE, ariaKeyShortcuts: "Alt+Shift+U", onclick: () => undoAgentChange(p.id) }));
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
// Keep or undo the change to the block the caret is in, without reaching for the buttons.
document.addEventListener("keydown", (e) => {
  if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey || (e.code !== "KeyK" && e.code !== "KeyU") || composing(e) || !reviewOn()) return;
  const sel = getSelection();
  const at = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null;
  const here = (at?.nodeType === 1 ? at as Element : at?.parentElement) ?? document.activeElement;
  const el = reviewActions.contains(document.activeElement) ? actionsFor : reviewBlockAt(here?.closest("[data-inplace-ui]") ? document.activeElement : here);
  const p = toReviewFor(el?.dataset.id);
  if (!p) return;
  e.preventDefault();
  if (e.code === "KeyK") return void keepAgentChange(p.id);
  if (!p.undoable) {
    showStatus(TOO_LARGE, "error", 6000);
    return announce(TOO_LARGE);
  }
  undoAgentChange(p.id);
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
          title: p.undoable ? "" : TOO_LARGE, onclick: () => undoAgentChange(p.id) })),
      ...(p.reason ? [make("p", { className: "why" }, make("span", { className: "why-label", textContent: "Why" }), p.reason)] : [])));
  }
  return make("div", { className: "to-review" },
    make("div", { className: "head" },
      make("h3", { textContent: `Your agent’s changes to review (${toReview.length})` }),
      make("button", { type: "button", className: "keep-all", textContent: "Keep all", onclick: () => keepAgentChange() })),
    make("div", { className: "copy" },
      make("span", { textContent: "A copy without these changes:" }),
      make("button", { type: "button", className: "act", textContent: "Print", title: "Print the document as it was before these changes",
        onclick: () => copyWithoutChanges("print") }),
      make("button", { type: "button", className: "act", textContent: "Download", title: "Save the document as it was before these changes",
        onclick: () => copyWithoutChanges("download") })),
    ...copyLeftNote(),
    items);
}

/** Which changes the last copy still had, because they couldn't be undone. */
function copyLeftNote() {
  const left = (copyLeft || []).filter((l) => toReview.some((p) => p.id === l.id));
  if (!left.length) return [];
  return [make("div", { className: "copy-left" },
    make("p", { textContent: left.length === 1 ? "The copy still has this change, because it couldn’t be undone:"
      : `The copy still has ${left.length} of these changes, because they couldn’t be undone:` }),
    // The server's reason is a whole sentence, for the undo itself; here only the "because" part is new.
    make("ul", {}, ...left.map((l) => make("li", {
      textContent: `${reviewWords(toReview.find((p) => p.id === l.id)!)}: ${l.why.replace(/^This can.t be undone, because /, "")}` }))))];
}

/**
 * Print or download the document with every change to review undone. The file keeps them: the
 * server undoes them on a copy. Changes it couldn't undo are listed under the buttons.
 */
async function copyWithoutChanges(how: "print" | "download") {
  // Opened right away, while the click still counts, or the browser may block it.
  const win = how === "print" ? window.open("", "_blank") : null;
  if (how === "print" && !win) return showStatus("Your browser blocked the window to print from. Allow pop-ups for this page and try again.", "error", 8000);
  // What the user just typed belongs in the copy too.
  for (const unsaved of pending()) {
    const el = byId(unsaved);
    if (el && !(await save(el))) return win?.close();
  }
  const url = `${location.pathname}?without-changes=${how}`;
  if (win) win.location.href = url;
  else {
    const link = make("a", { href: url, download: "" });
    document.body.append(link);
    link.click();
    link.remove();
  }
  try {
    copyLeft = (await (await fetch("/__inplace/without-changes")).json()).left;
  } catch {
    copyLeft = null;
  }
  const n = copyLeft?.length || 0;
  announce(n ? `The copy still has ${n === 1 ? "one change" : `${n} changes`} that couldn’t be undone. They’re listed under the buttons.`
    : how === "print" ? "Opened a copy without these changes to print." : "Downloaded a copy without these changes.");
  if (changesPanel.classList.contains("open")) renderChanges();
}
/** Keep one of the agent's changes, or all of them: they only leave the list. */
async function keepAgentChange(id?: string) {
  hideActions();
  const p = id ? toReview.find((c) => c.id === id) : undefined;
  const res = await post(id ? "suggestion/keep" : "suggestion/keep-all", id ? { id } : {});
  if (!res.ok) {
    const error = res.body.error || "Couldn’t keep this change.";
    showStatus(error, "error", 6000);
    announce(error);
  } else announce(p ? `Kept your agent’s change to this ${noun(p.tag)}.` : "Kept all of your agent’s changes.");
  await loadHistory();
}

/** Put back what the block was before the agent changed it, then reload to show the file as it is now. */
async function undoAgentChange(id: string) {
  hideActions();
  for (const unsaved of pending()) {
    const el = byId(unsaved);
    if (el && !(await save(el))) return;
  }
  const p = toReview.find((c) => c.id === id);
  const res = await post("suggestion/undo", { id });
  if (!res.ok) {
    const error = res.body.error || "Couldn’t undo this change.";
    showStatus(error, "error", 8000);
    announce(error);
    return loadHistory();
  }
  version = res.body.version;
  try { sessionStorage.setItem(ANNOUNCE_KEY, `Undid your agent’s change to this ${noun(p?.tag || "")}.`); } catch {}
  // Not marked as the agent's change after the reload: it's the user's own.
  reload([...document.querySelectorAll<HTMLElement>("[data-id]")].map((el) => el.dataset.id!).concat(id));
}

let reviewFrame = 0;
const repaintToReview = () => { cancelAnimationFrame(reviewFrame); reviewFrame = requestAnimationFrame(paintToReview); };
addEventListener("resize", repaintToReview);
addEventListener("load", repaintToReview);
if (typeof ResizeObserver === "function") new ResizeObserver(repaintToReview).observe(document.documentElement);
