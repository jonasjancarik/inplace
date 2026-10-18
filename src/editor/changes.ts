// --- the list of changes ---
const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="currentColor"/><path d="M9 9h14M9 15h14M9 21h8" stroke="#1f2a24" stroke-width="2.4" stroke-linecap="round"/><path d="M21 19v7" stroke="#e9b949" stroke-width="2.4" stroke-linecap="round"/></svg>';
const SEEN_KEY = `${STATE_KEY}:seen-changes`;
let historyEntries: HistoryEntry[] = [];
let authorMarks: Record<string, AuthorMark> = {}; // who wrote each block last
let meId: string | undefined; // the id the host gave this person, if it did
let undoable = new Set<string>(); // "kind id" of the user's changes that can still be undone
const UNDO_KINDS: Record<string, UndoKind | undefined> = { moved: "move", added: "add", removed: "remove", retagged: "retag" };
let seenChanges: number | null = null;
try { seenChanges = JSON.parse(sessionStorage.getItem(SEEN_KEY) || "null"); } catch {}
const latestByAgent = () => historyEntries.reduce((n, e) => (e.by.kind === "agent" ? Math.max(n, e.n) : n), 0);

function updateCorner() {
  corner.classList.toggle("stash", stashCount > 0);
  corner.classList.add("shown");
  if (stashCount) {
    corner.removeAttribute("aria-label");
    corner.removeAttribute("title");
    corner.textContent = stashCount === 1 ? "1 edit set aside" : `${stashCount} edits set aside`;
    return;
  }
  corner.setAttribute("aria-label", "inplace: changes and version");
  corner.title = "Changes and version";
  corner.innerHTML = LOGO + "<span>inplace</span>";
  if (latestByAgent() > (seenChanges ?? 0)) corner.append(make("span", { className: "dot" }));
}

async function loadHistory() {
  try {
    const data: { entries: HistoryEntry[]; undoable?: { kind: UndoKind; id: string }[]; authors?: Record<string, AuthorMark>; me?: string } =
      await (await fetch("/__inplace/history")).json();
    historyEntries = data.entries;
    authorMarks = data.authors || {};
    meId = data.me;
    undoable = new Set((data.undoable || []).map((u) => `${u.kind} ${u.id}`));
  } catch {
    return;
  }
  // A newly opened page starts with nothing new to point out.
  if (seenChanges === null) markChangesSeen();
  updateCorner();
  paintAuthors();
  if (changesPanel.classList.contains("open")) renderChanges();
}

function markChangesSeen() {
  seenChanges = latestByAgent();
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(seenChanges)); } catch {}
}

const NOUNS: Record<string, string | undefined> = { P: "paragraph", LI: "list item", TR: "table row", TD: "table cell", TH: "table cell", TABLE: "table",
  UL: "list", OL: "list", DT: "term", DD: "description", FIGURE: "figure", FIGCAPTION: "caption", CAPTION: "caption",
  BLOCKQUOTE: "quote" };
const noun = (tag: string) => (/^h\d$/i.test(tag) ? "heading" : NOUNS[tag.toUpperCase()] || "text");
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);
function describe(change: BlockChange) {
  if (change.kind === "added") return `New ${noun(change.tag)}`;
  if (change.kind === "removed") return `Removed ${noun(change.tag)}`;
  if (change.kind === "moved") return `Moved ${noun(change.tag)}`;
  if (change.fromTag && noun(change.fromTag) !== noun(change.tag)) return `${capital(noun(change.fromTag))} \u2192 ${noun(change.tag)}`;
  return `Edited ${noun(change.tag)}`;
}

// The changed words with a few words around them, so a one-word edit in a
// long paragraph is easy to spot. Long unchanged stretches are shortened.
function snippet(change: BlockChange) {
  const before = change.before ?? "", after = change.after ?? "";
  if (change.kind === "added") return [make("ins", { textContent: clipText(after) })];
  if (change.kind === "removed") return [make("del", { textContent: clipText(before) })];
  if (change.kind === "moved" || before === after) return [clipText(after)];
  const CONTEXT = 8; // words and the spaces between them
  const runs = diffWords(before, after);
  const out: (Node | string)[] = [];
  runs.forEach((run, k) => {
    if (run.same) {
      const t = run.same, first = k === 0, last = k === runs.length - 1;
      if (first && t.length > CONTEXT) out.push("\u2026" + t.slice(-CONTEXT).join(""));
      else if (last && t.length > CONTEXT) out.push(t.slice(0, CONTEXT).join("") + "\u2026");
      else if (!first && !last && t.length > CONTEXT * 2 + 1)
        out.push(t.slice(0, CONTEXT).join("") + " \u2026 " + t.slice(-CONTEXT).join(""));
      else out.push(t.join(""));
      return;
    }
    // Spaces at the edges of a pure insertion or deletion stay outside the mark.
    const gone = run.gone.join(""), added = run.added.join("");
    const lead = (!gone.trim() ? added : !added.trim() ? gone : "").match(/^\s*/)![0];
    const trail = (!gone.trim() ? added : !added.trim() ? gone : "").match(/\s*$/)![0];
    if (lead) out.push(lead);
    if (gone.trim()) out.push(make("del", { textContent: clipText(gone.trim(), 160) }));
    if (gone.trim() && added.trim()) out.push(" ");
    if (added.trim()) out.push(make("ins", { textContent: clipText(added.trim(), 160) }));
    if (trail) out.push(trail);
  });
  return out;
}

function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 45) return "just now";
  if (s < 90) return "a minute ago";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// The words for an author: "you" for this person, "your agent", or a name the host gave.
const isMe = (a: Author) => a.kind === "person" && (!a.id || !meId || a.id === meId);
const byWords = (a: Author) => (a.kind === "agent" ? (a.name ? a.name : "your agent") : isMe(a) ? "you" : a.name || "someone else");

async function goTo(el: HTMLElement, change: BlockChange, by: "you" | "agent") {
  if (matchMedia("(max-width: 600px)").matches) closeChanges();
  if (!(await uncover(el))) return showStatus(HIDDEN_CHANGE, "info", 4000);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const r = el.getBoundingClientRect();
  const before = change.kind === "changed" ? change.before : undefined;
  if (r.top >= 0 && r.bottom <= innerHeight) return replay(el, before, by);
  let done = false;
  const then = () => { if (!done) { done = true; replay(el, before, by); } };
  addEventListener("scrollend", then, { once: true });
  setTimeout(then, reduced ? 0 : 700);
  el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
}

// A block inside a closed <details>, a hidden tab panel or a collapsed
// accordion has no size, so scrolling to it does nothing. Open what hides it
// first, as a person would. False if it's still hidden.
const HIDDEN_CHANGE = "This change is in a part of the page that's hidden.";
// The content of a closed <details> still has a size, so ask the browser.
function isShown(el: Element) {
  return el.checkVisibility ? el.checkVisibility() : el.getClientRects().length > 0;
}
async function uncover(el: HTMLElement) {
  for (let d: HTMLDetailsElement | null | undefined = el.closest<HTMLDetailsElement>("details:not([open])"); d; d = d.parentElement?.closest<HTMLDetailsElement>("details:not([open])")) d.open = true;
  const clicked = new Set<HTMLElement>();
  while (!isShown(el)) {
    let hidden: HTMLElement | null = el;
    while (hidden && !(hidden.hidden || getComputedStyle(hidden).display === "none")) hidden = hidden.parentElement;
    // The usual pattern for tabs and accordions: a button with aria-controls.
    const control = hidden?.id && [...document.querySelectorAll<HTMLElement>("[aria-controls]")]
      .find((c) => c.getAttribute("aria-controls")!.split(/\s+/).includes(hidden!.id) && !c.closest("[data-inplace-ui]"));
    if (!control || clicked.has(control)) break;
    clicked.add(control);
    control.click();
    if (!isShown(el)) await new Promise(requestAnimationFrame);
  }
  return isShown(el);
}

function renderChanges() {
  const list = make("div", { className: "list" }, authorsSwitch());
  if (!canEdit) {
    list.append(make("p", { className: "access", textContent: canComment
      ? "You can comment on this document, but not edit it."
      : "You can read this document, but not edit it or comment on it." }));
  }
  const agentLine = agentStatusLine();
  if (agentLine) list.append(agentLine);
  const commentList = commentsGroup();
  if (commentList) list.append(commentList);
  if (stashCount) {
    list.append(make("div", { className: "aside" },
      make("span", { textContent: stashCount === 1
        ? "You and your agent changed the same words, so your version was set aside."
        : `You and your agent changed the same words in ${stashCount} places, so your versions were set aside.` }),
      ...(canEdit ? [make("button", { type: "button", textContent: "Review", onclick: () => { closeChanges(); openStash(); } })] : [])));
  }
  if (!historyEntries.length) list.append(make("p", { className: "empty", textContent: "Nothing has changed yet." }));
  const offered = new Set<string>(); // each change gets Undo once, on its newest entry
  for (const entry of [...historyEntries].reverse()) {
    const who = make("div", { className: "who" });
    if (entry.by.kind === "agent") {
      const icon = make("span", { className: "star" });
      icon.innerHTML = STAR;
      who.append(icon, entry.by.name || "Your agent");
    } else who.append(isMe(entry.by) ? "You" : entry.by.name || "Someone else");
    who.append(make("span", { className: "when", textContent: ago(entry.at) }));
    const items = make("ul");
    for (const change of entry.changes) {
      const el = change.kind !== "removed" && document.querySelector<HTMLElement>(`[data-id="${CSS.escape(change.id)}"]`);
      const body = [make("span", { className: "kind", textContent: describe(change) }),
        make("span", { className: "text" }, ...snippet(change))];
      const item = make("li", {}, el
        ? make("button", { type: "button", className: "change", title: "Show in the document", onclick: () => goTo(el, change, entry.by.kind === "agent" ? "agent" : "you") }, ...body)
        : make("div", { className: "change" }, ...body));
      const kind = canEdit && isMe(entry.by) && UNDO_KINDS[change.fromTag ? "retagged" : change.kind];
      if (kind && undoable.has(`${kind} ${change.id}`) && !offered.has(`${kind} ${change.id}`)) {
        offered.add(`${kind} ${change.id}`);
        item.classList.add("undoable");
        item.append(make("button", { type: "button", className: "undo", textContent: "Undo",
          ariaLabel: `Undo: ${describe(change)}`, onclick: () => undoChange(kind, change.id) }));
      }
      items.append(item);
    }
    const node = make("div", { className: "entry" }, who, items);
    node.dataset.by = entry.by.kind === "agent" ? "agent" : "you";
    list.append(node);
  }
  changesPanel.replaceChildren(
    make("header", {}, make("h2", { textContent: "Changes" }), reviewSwitch(),
      make("button", { type: "button", className: "x", textContent: "\u00d7", ariaLabel: "Close", onclick: closeChanges })),
    list, versionLine());
}

/** Which inplace this is, so it's clear whether a restart is needed to get the latest. */
function versionLine() {
  let build: { version: string; branch?: string; commit?: string; dirty?: boolean } | null = null;
  try { build = JSON.parse(script.dataset.build || "null"); } catch {}
  if (!build) return make("footer");
  const where = build.commit ? ` \u00b7 ${build.branch ? build.branch + " @ " : ""}${build.commit}${build.dirty ? " (uncommitted changes)" : ""}` : "";
  return make("footer", { textContent: `inplace ${build.version}${where}`, title: "The version of inplace serving this page" });
}

function openChanges() {
  renderChanges();
  changesPanel.classList.add("open");
  corner.setAttribute("aria-expanded", "true");
  markChangesSeen();
  updateCorner();
}
function closeChanges() {
  changesPanel.classList.remove("open");
  corner.setAttribute("aria-expanded", "false");
}
corner.addEventListener("click", () => (changesPanel.classList.contains("open") ? closeChanges() : openChanges()));
document.addEventListener("pointerdown", (e) => {
  if (changesPanel.classList.contains("open") && !changesPanel.contains(e.target as Node) && !corner.contains(e.target as Node)) closeChanges();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && changesPanel.classList.contains("open") && !overlay.classList.contains("open")) closeChanges();
});
