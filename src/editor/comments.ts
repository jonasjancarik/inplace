// --- comments: select text or hover an element, and write what should change ---
// Comments are kept by the server, never in the document. The commented text is
// highlighted with the CSS Custom Highlight API, so the editable DOM isn't touched.
const COMMENT_SHORTCUT = MOD === "⌘" ? "⌘⌥M" : "Ctrl+Alt+M";
const canHighlight = typeof Highlight === "function" && !!CSS.highlights;
let comments: PageComment[] = [];
/** Where a comment is on the page now. */
interface CommentPlace {
  el: HTMLElement | null;
  range: Range | null | undefined;
  lost: boolean;
}
let commentPlaces = new Map<number, CommentPlace>(); // by comment number
let anchoring: Anchoring | null = null;
// A URL, not a file TypeScript can follow, so the module is typed here.
const anchoringReady = import("/__inplace/anchor.js" as string).then((m: Anchoring) => (anchoring = m), () => null);

const commentLayer = make("div", { id: "inplace-comment-layer" });
commentLayer.dataset.inplaceUi = "";
const commentBox = make("div", { id: "inplace-comment-box" });
commentBox.dataset.inplaceUi = "";
commentBox.setAttribute("role", "dialog");
commentBox.setAttribute("aria-label", "Comment");
const elementCommentButton = make("button", { type: "button", id: "inplace-comment-here", textContent: "Comment" });
elementCommentButton.dataset.inplaceUi = "";
document.body.append(commentLayer, commentBox, elementCommentButton);

// The selection toolbar gets a Comment button after the formatting buttons.
const commentButton = make("button", { type: "button", textContent: "Comment", title: `Comment (${COMMENT_SHORTCUT})` });
commentButton.dataset.comment = "";
formatToolbar.append(make("span", { className: "sep" }), commentButton);
commentButton.addEventListener("click", () => startComment());

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
const commentNoun = (el: Element) => (el.tagName.toLowerCase() === "svg" ? "chart" : el.tagName === "IMG" ? "image" : nameOf(el));

// Character offsets in an element's text, and back.
// Text as the file has it: words crossed out by "Show what changed" and
// other page-only marks don't count, but the words it marks as new do.
const NOT_IN_FILE = "[data-inplace-ui]:not(ins)";
function fileText(root: Node): string {
  const copy = root.cloneNode(true) as Element | DocumentFragment;
  for (const ui of copy.querySelectorAll(NOT_IN_FILE)) ui.remove();
  return copy.textContent!;
}
function textOffset(el: Node, node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(el, 0);
  range.setEnd(node, offset);
  return fileText(range.cloneContents()).length;
}
const inUi = (node: Node) => !!(node.nodeType === 1 ? node as Element : node.parentElement)?.closest(NOT_IN_FILE);
function rangeIn(el: Node, start: number, end: number) {
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let at = 0;
  let started = false;
  for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
    const next = at + t.data.length;
    if (!started && start <= next) { range.setStart(t, start - at); started = true; }
    if (started && end <= next) { range.setEnd(t, end - at); return range; }
    at = next;
  }
  return null;
}

let seenComments: Set<number> | null = null; // numbers of the comments loaded so far, to notice new ones from the agent
async function loadComments() {
  try {
    comments = (await (await fetch("/__inplace/comments")).json()).comments;
  } catch {
    return;
  }
  const fromAgent = seenComments ? comments.filter((c) => c.by && c.status === "open" && !seenComments!.has(c.n)).length : 0;
  seenComments = new Set(comments.map((c) => c.n));
  if (fromAgent) showStatus(fromAgent === 1 ? "Your agent left a comment" : `Your agent left ${fromAgent} comments`, "info", 5000);
  await anchoringReady;
  placeComments();
  updateCorner();
  if (changesPanel.classList.contains("open")) renderChanges();
  if (writtenBeforeReload) reopenWriting();
}

function placeComments() {
  commentPlaces = new Map();
  for (const c of comments) {
    const el = byId(c.id);
    if (!el) commentPlaces.set(c.n, { el: null, range: null, lost: true });
    else if (!c.quote) commentPlaces.set(c.n, { el, range: null, lost: false });
    else {
      // A comment with a quote always has its prefix and suffix (see src/comments.ts).
      const found = anchoring?.findQuote(el.textContent!, c as QuoteContext);
      const range = found && rangeIn(el, found.start, found.end);
      commentPlaces.set(c.n, { el, range, lost: !range });
    }
  }
  paintComments();
}

function paintComments() {
  const open = comments.filter((c) => c.status === "open");
  if (canHighlight) {
    for (const [name, list] of [["inplace-comment", open.filter((c) => !c.by)], ["inplace-agent-comment", open.filter((c) => c.by)]] as [string, PageComment[]][]) {
      const ranges = list.map((c) => commentPlaces.get(c.n)?.range).filter(Boolean) as Range[];
      if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
      else CSS.highlights.delete(name);
    }
  }
  // One marker per element with open comments, at its top right corner.
  const byElement = new Map<HTMLElement, PageComment[]>();
  for (const c of open) {
    const el = commentPlaces.get(c.n)?.el;
    if (el) byElement.set(el, [...(byElement.get(el) ?? []), c]);
  }
  commentLayer.replaceChildren(...[...byElement].map(([el, list]) => {
    const marker = make("button", { type: "button", className: list.every((c) => c.by) ? "marker agent" : "marker", textContent: String(list.length),
      title: list.length === 1 ? "1 comment" : `${list.length} comments` });
    marker.setAttribute("aria-label", marker.title);
    (marker as Marker).inplaceTarget = el;
    marker.addEventListener("click", () => showComments(list, marker.getBoundingClientRect()));
    return marker;
  }));
  positionMarkers();
}

/** A comment marker, with the element it sits on. */
type Marker = HTMLButtonElement & { inplaceTarget: Element };

function positionMarkers() {
  for (const marker of commentLayer.children as HTMLCollectionOf<Marker>) {
    const r = marker.inplaceTarget.getBoundingClientRect();
    const hidden = r.bottom < 0 || r.top > innerHeight || (!r.width && !r.height);
    marker.style.display = hidden ? "none" : "";
    marker.style.left = `${Math.min(innerWidth - 26, r.right + 4)}px`;
    marker.style.top = `${Math.max(4, r.top - 2)}px`;
  }
}
let markerFrame = 0;
const moveMarkers = () => {
  if (!markerFrame) markerFrame = requestAnimationFrame(() => { markerFrame = 0; positionMarkers(); });
};
addEventListener("scroll", moveMarkers, { passive: true, capture: true });
addEventListener("resize", moveMarkers);
// Typing moves text around: find the commented words again once the user stops.
let replaceTimer: number | null = null;
document.addEventListener("input", () => {
  clearTimeout(replaceTimer!);
  replaceTimer = setTimeout(placeComments, 400);
});

// The box under the selection, or next to a marker or element.
let draft: ({ id: string } & QuoteContext) | null = null; // while a new comment is being written
function openBox(rect: DOMRect, ...children: (Node | string)[]) {
  commentBox.replaceChildren(...children);
  commentBox.classList.add("open");
  const w = commentBox.offsetWidth;
  const h = commentBox.offsetHeight;
  const top = rect.bottom + 8 + h <= innerHeight - 8 ? rect.bottom + 8 : Math.max(8, rect.top - h - 8);
  commentBox.style.top = `${top}px`;
  commentBox.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, rect.left))}px`;
}
function closeBox() {
  commentBox.classList.remove("open");
  draft = null;
  if (canHighlight) CSS.highlights.delete("inplace-comment-draft");
}

// A text field where Enter submits, Shift+Enter adds a line and Escape cancels.
function commentField(value: string, submit: () => void, label = "Comment", placeholder = "What should change?") {
  const field = make("textarea", { value, placeholder, rows: 3 });
  field.setAttribute("aria-label", label);
  field.addEventListener("keydown", (e) => {
    if (composing(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeBox();
    }
  });
  return field;
}

/**
 * A triple-click on the last paragraph before the page's own controls (the toolbar, the comment
 * markers) ends the selection inside them. Pull such an end back to the edge of the paragraph it
 * started in, so only selections that really take in crossed-out text are refused.
 */
function trimOutsideUi(range: Range) {
  const block = (node: Node) => (node.nodeType === 1 ? node as Element : node.parentElement)?.closest<HTMLElement>("[data-id]");
  const stray = (node: Node) => inUi(node) && !block(node);
  const start = stray(range.startContainer) ? block(range.endContainer) : block(range.startContainer);
  if (!start || stray(range.startContainer) && stray(range.endContainer)) return;
  if (stray(range.endContainer)) range.setEnd(start, start.childNodes.length);
  if (stray(range.startContainer)) range.setStart(start, 0);
}

function startComment(el: HTMLElement | null | undefined = null) {
  if (!canComment) return;
  let range: Range | null = null;
  if (!el) {
    const sel = getSelection()!;
    if (!sel.rangeCount) return;
    range = sel.getRangeAt(0).cloneRange();
    trimOutsideUi(range);
    if (inUi(range.startContainer) || inUi(range.endContainer))
      return showStatus("Crossed-out text is no longer in the document, so it can't be commented on.", "info", 4000);
    const node = range.commonAncestorContainer;
    el = (node.nodeType === 1 ? node as Element : node.parentElement)?.closest<HTMLElement>("[data-id]");
    if (!el || el.closest("[data-inplace-ui]")) return;
  }
  let ctx: QuoteContext = { quote: "", prefix: "", suffix: "" };
  if (range && !range.collapsed && anchoring) {
    const text = fileText(el);
    const start = textOffset(el, range.startContainer, range.startOffset);
    const end = textOffset(el, range.endContainer, range.endOffset);
    // Leave out spaces at the edges of the selection.
    const lead = text.slice(start, end).match(/^\s*/)![0].length;
    const trail = text.slice(start, end).match(/\s*$/)![0].length;
    if (end - trail > start + lead) ctx = anchoring.buildContext(text, start + lead, end - trail);
  }
  openDraft(el, ctx, ctx.quote ? range!.cloneRange() : null);
}

// The box for a new comment on an element, or on the quoted words in it when they were found.
function openDraft(el: HTMLElement, ctx: QuoteContext, quoteRange: Range | null, text = "", caret?: [number, number]) {
  draft = { id: el.dataset.id!, ...ctx };
  if (canHighlight && quoteRange) CSS.highlights.set("inplace-comment-draft", new Highlight(quoteRange));
  const field = commentField(text, () => addComment(field.value));
  const heading = ctx.quote
    ? make("p", { className: "quote", textContent: clipText(ctx.quote, 120) })
    : make("p", { className: "about", textContent: `Comment on this ${commentNoun(el)}` });
  openBox(quoteRange ? quoteRange.getBoundingClientRect() : el.getBoundingClientRect(), heading, field,
    make("div", { className: "actions" },
      make("button", { type: "button", textContent: "Cancel", onclick: closeBox }),
      make("button", { type: "button", className: "primary", textContent: "Add comment", onclick: () => addComment(field.value) })));
  formatToolbar.style.display = "none";
  field.focus();
  if (caret) field.setSelectionRange(...caret);
}

async function addComment(text: string) {
  if (!draft || !text.trim()) return;
  const res = await post("comment", { action: "add", ...draft, text });
  if (!res.ok) return showStatus(res.status === 404 ? "Couldn't add the comment: this part of the page has changed. Reload and try again."
    : "Couldn't add the comment. Is inplace still running?", "error", 5000);
  closeBox();
  getSelection()!.removeAllRanges();
  showStatus("Comment added");
  loadComments();
}

async function changeComment(payload: object, done?: string) {
  const res = await post("comment", payload);
  if (!res.ok) return showStatus("Couldn't change the comment. Is inplace still running?", "error", 5000);
  if (done) showStatus(done);
  loadComments();
}

// Comments being changed or answered, by where and what ("list:edit:3"), with the words written
// so far. The list of changes is drawn anew whenever something changes, and the page reloads
// when the agent edits the file; neither should throw those words away.
const writing = new Map<string, string>();
/** The field being typed in, and where in it. */
type WritingFocus = { key: string; start: number; end: number };
let writingFocus: WritingFocus | null = null;
function keepWriting(scope: Element) {
  for (const field of scope.querySelectorAll<HTMLTextAreaElement>("textarea[data-writing]")) {
    writing.set(field.dataset.writing!, field.value);
    if (field === document.activeElement) writingFocus = { key: field.dataset.writing!, start: field.selectionStart, end: field.selectionEnd };
  }
}
// Opens the field again, with what was written in it, if it was open before.
function resumeWriting(key: string, open: () => HTMLTextAreaElement) {
  const text = writing.get(key);
  if (text === undefined) return;
  writing.delete(key);
  const field = open();
  field.value = text;
  const at = writingFocus?.key === key ? writingFocus : null;
  if (!at) return;
  writingFocus = null;
  // Once the comment is on the page.
  queueMicrotask(() => { field.focus(); field.setSelectionRange(at.start, at.end); });
}

// A comment as shown in the box and in the list of changes. While it's open, the user's own
// comments have Edit and Delete (not other people's, where the host names people), and the
// agent's have Answer and Dismiss.
function commentView(c: PageComment, { inList = false }: { inList?: boolean } = {}) {
  const place = commentPlaces.get(c.n);
  const node = make("div", { className: `comment ${c.status}${c.by ? " agent" : ""}` });
  if (place?.lost && c.status === "open") {
    node.append(make("p", { className: "lost", textContent: "The text this was about has changed:" }),
      make("p", { className: "quote old", textContent: clipText(c.quote || "", 160) }));
  } else if (c.quote) node.append(make("p", { className: "quote", textContent: clipText(c.quote, 160) }));
  else if (place?.el) node.append(make("p", { className: "about", textContent: `On this ${commentNoun(place.el)}` }));
  const text = make("p", { className: "text", textContent: c.by ? `Your agent: ${c.text}` : c.text });
  node.append(text);
  const answer = c.answer ? make("p", { className: "text", textContent: `You: ${c.answer}` }) : null;
  if (answer) node.append(answer);
  if (c.reply) node.append(make("p", { className: "reply", textContent: `Your agent: ${c.reply}` }));
  const state = c.dismissed ? "Dismissed" : c.status === "done" ? "Done"
    : c.by && !c.answer ? "Waiting for your answer" : "Not done yet";
  const meta = make("div", { className: "meta" }, make("span", { textContent: `${state} · ${ago(c.created)}` }));
  const where = `${inList ? "list" : "box"}:`;
  let resume: (() => void) | null = null;
  if (!canComment) {
    // Read-only: the comment and its state, nothing to change.
  } else if (c.status === "open" && c.by) {
    const sendAnswer = (value: string) => {
      if (!inList) closeBox();
      changeComment({ action: "answer", n: c.n, text: value }, "Answer sent");
    };
    // Answers the agent suggested, sent with one click until the user has answered.
    const choices = c.options?.length && !c.answer
      ? make("div", { className: "choices" }, ...c.options.map((option) =>
        make("button", { type: "button", textContent: option, onclick: () => sendAnswer(option) })))
      : null;
    if (choices) text.after(choices);
    const writeAnswer = () => {
      const field = commentField(c.answer ?? "", () => save(), "Answer", "Your answer");
      field.dataset.writing = `${where}answer:${c.n}`;
      const save = () => {
        if (!field.value.trim()) return;
        delete field.dataset.writing;
        sendAnswer(field.value);
      };
      const shown = answer ?? choices;
      if (shown) shown.replaceWith(field);
      else text.after(field);
      field.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && inList) { e.stopPropagation(); shown ? field.replaceWith(shown) : field.remove(); }
      });
      meta.replaceChildren(make("button", { type: "button", textContent: "Send", onclick: save }));
      field.focus();
      return field;
    };
    resume = () => resumeWriting(`${where}answer:${c.n}`, writeAnswer);
    // With suggestions, writing an answer is the last of them; otherwise it's a link next to Dismiss.
    if (choices) choices.append(make("button", { type: "button", className: "own", textContent: "Write your own", onclick: writeAnswer }));
    else meta.append(make("button", { type: "button", textContent: c.answer ? "Change answer" : "Answer", onclick: writeAnswer }));
    meta.append(
      make("button", { type: "button", textContent: "Dismiss", onclick: () => {
        if (!inList) closeBox();
        changeComment({ action: "dismiss", n: c.n }, "Comment dismissed");
      } }));
  } else if (c.status === "open" && meId && c.from?.id && c.from.id !== meId) {
    // Someone else's comment: it can be read, and only its writer changes it.
  } else if (c.status === "open") {
    const edit = () => {
      const field = commentField(c.text, () => save());
      field.dataset.writing = `${where}edit:${c.n}`;
      const save = () => {
        if (!field.value.trim()) return;
        delete field.dataset.writing;
        changeComment({ action: "edit", n: c.n, text: field.value }, "Comment changed");
      };
      text.replaceWith(field);
      field.addEventListener("keydown", (e) => { if (e.key === "Escape" && inList) { e.stopPropagation(); field.replaceWith(text); } });
      meta.replaceChildren(make("button", { type: "button", textContent: "Save", onclick: save }));
      field.focus();
      return field;
    };
    resume = () => resumeWriting(`${where}edit:${c.n}`, edit);
    meta.append(
      make("button", { type: "button", textContent: "Edit", onclick: edit }),
      make("button", { type: "button", textContent: "Delete", onclick: () => {
        if (!inList) closeBox();
        changeComment({ action: "delete", n: c.n }, "Comment deleted");
      } }));
  }
  if (inList && place?.el) {
    const show = make("button", { type: "button", textContent: "Show", onclick: () => {
      closeChanges();
      place.el!.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } });
    meta.prepend(show);
  }
  node.append(meta);
  resume?.();
  return node;
}

function showComments(list: PageComment[], rect: DOMRect) {
  draft = null;
  openBox(rect, ...list.map((c) => commentView(c)));
}

// The "Comments" group at the top of the list of changes.
function commentsGroup() {
  if (!comments.length) return null;
  const group = make("div", { className: "comments" }, make("h3", { textContent: "Comments" }));
  for (const c of [...comments].reverse()) group.append(commentView(c, { inList: true }));
  if (canComment && comments.some((c) => c.status === "done")) {
    group.append(make("button", { type: "button", className: "clear", textContent: "Clear done comments",
      onclick: () => changeComment({ action: "clear" }) }));
  }
  return group;
}

// Clicking highlighted text shows its comment; the caret still goes where the user clicked.
document.addEventListener("click", (e) => {
  if (!canHighlight || (e.target as Element).closest?.("[data-inplace-ui]") || !getSelection()!.isCollapsed) return;
  const at = document.caretPositionFromPoint?.(e.clientX, e.clientY);
  const point = at ? { node: at.offsetNode, offset: at.offset } : (() => {
    const r = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    return r && { node: r.startContainer, offset: r.startOffset };
  })();
  if (!point) return;
  const hit = comments.filter((c) => {
    const range = c.status === "open" && commentPlaces.get(c.n)?.range;
    try { return range && range.isPointInRange(point.node, point.offset); } catch { return false; }
  });
  if (hit.length) showComments(hit, commentPlaces.get(hit[0].n)!.range!.getBoundingClientRect());
});

// Elements without text to select (charts, figures, rows, tables) get a Comment button on hover.
const WHOLE = new Set(["FIGURE", "TABLE", "TR", "IMG", "PICTURE", "VIDEO", "CANVAS", "UL", "OL", "DL", "BLOCKQUOTE", "PRE"]);
let hovered: HTMLElement | null = null;
function wholeTarget(node: EventTarget | null) {
  for (let el = (node as Element | null)?.closest?.<HTMLElement>("[data-id]"); el; el = el.parentElement?.closest<HTMLElement>("[data-id]")) {
    if (el.getAttribute("contenteditable") === "true") continue;
    if (WHOLE.has(el.tagName) || el.tagName.toLowerCase() === "svg" || !el.querySelector("[contenteditable=true]")) return el;
  }
  return null;
}
document.addEventListener("mousemove", (e) => {
  if (!canComment || e.target === elementCommentButton || drag) return;
  const el = (e.target as Element).closest?.("[data-inplace-ui]") ? null : wholeTarget(e.target);
  if (el === hovered) return;
  hovered = el;
  if (!el) return (elementCommentButton.style.display = "none");
  const r = el.getBoundingClientRect();
  elementCommentButton.title = `Comment on this ${commentNoun(el)}`;
  elementCommentButton.style.display = "block";
  // Just outside the element's right edge, so it doesn't cover anything; inside when there's no room.
  const w = elementCommentButton.offsetWidth;
  const outside = r.right + 6 + w <= innerWidth - 4;
  elementCommentButton.style.left = `${outside ? r.right + 6 : Math.max(4, r.right - w - 4)}px`;
  elementCommentButton.style.top = `${Math.max(4, r.top + (outside ? 0 : 4))}px`;
}, { passive: true });
addEventListener("scroll", () => { hovered = null; elementCommentButton.style.display = "none"; }, { passive: true, capture: true });
elementCommentButton.addEventListener("click", () => {
  const el = hovered;
  elementCommentButton.style.display = "none";
  if (el) startComment(el);
});

document.addEventListener("keydown", (e) => {
  if (canComment && e.code === "KeyM" && e.altKey && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
    e.preventDefault();
    startComment();
  } else if (e.key === "Escape" && commentBox.classList.contains("open")) closeBox();
});
document.addEventListener("pointerdown", (e) => {
  if (commentBox.classList.contains("open") && !commentBox.contains(e.target as Node) && !commentLayer.contains(e.target as Node)) closeBox();
});

// --- comments being written when the page reloads, such as when the agent edits the file ---
/** What was being written in the comment box and the list of changes before a reload. */
interface WritingState {
  draft?: { id: string; text: string; caret?: [number, number] } & QuoteContext;
  writing?: [string, string][];
  focus?: WritingFocus | null;
}
const WRITING_KEY = `${STATE_KEY}:writing`;
function rememberWriting() {
  const boxOpen = commentBox.classList.contains("open");
  if (boxOpen) keepWriting(commentBox);
  keepWriting(changesPanel);
  const field = draft && boxOpen ? commentBox.querySelector("textarea") : null;
  const state: WritingState = { writing: [...writing], focus: writingFocus };
  if (draft && field?.value.trim()) {
    state.draft = { ...draft, text: field.value, caret: field === document.activeElement ? [field.selectionStart, field.selectionEnd] : undefined };
  }
  if (!state.draft && !writing.size) return;
  try { sessionStorage.setItem(WRITING_KEY, JSON.stringify(state)); } catch {}
}

let writtenBeforeReload: WritingState | null = null;
try { writtenBeforeReload = JSON.parse(sessionStorage.getItem(WRITING_KEY) || "null"); sessionStorage.removeItem(WRITING_KEY); } catch {}

// Once the comments are loaded, so they can be found on the page again.
function reopenWriting() {
  const state = writtenBeforeReload!;
  writtenBeforeReload = null;
  if (state.focus) writingFocus = state.focus;
  let toList = false;
  for (const [key, text] of state.writing ?? []) {
    const [where, kind, n] = key.split(":");
    const c = comments.find((c) => c.n === Number(n) && c.status === "open");
    if (!c) continue; // done or deleted meanwhile: there's nothing to change any more
    const place = commentPlaces.get(c.n);
    if (where === "box" && place?.el) {
      writing.set(key, text);
      showComments([c], (place.range ?? place.el).getBoundingClientRect());
    } else {
      // Its text is gone from the page, so it's shown in the list of changes instead.
      const listKey = `list:${kind}:${n}`;
      writing.set(listKey, text);
      if (writingFocus?.key === key) writingFocus.key = listKey;
      toList ||= where === "box";
    }
  }
  if (toList) openChanges();
  else if (changesPanel.classList.contains("open")) renderChanges();
  const d = state.draft;
  if (!d) return;
  const el = byId(d.id);
  if (!el) {
    showStatus("Your agent removed the part you were commenting on, so the comment you were writing couldn't be kept.", "error", true);
    return;
  }
  const ctx: QuoteContext = { quote: d.quote, prefix: d.prefix, suffix: d.suffix };
  const found = d.quote ? anchoring?.findQuote(el.textContent!, ctx) : null;
  openDraft(el, ctx, (found && rangeIn(el, found.start, found.end)) || null, d.text, d.caret);
}
