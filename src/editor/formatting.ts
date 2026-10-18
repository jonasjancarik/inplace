// --- formatting: bold, italic, strikethrough, code, links, headings ---
type FormatName = "bold" | "italic" | "strike" | "code" | "link";
const FORMATS: Record<FormatName, { tag: string; match: string }> = {
  bold: { tag: "strong", match: "strong, b" },
  italic: { tag: "em", match: "em, i" },
  strike: { tag: "s", match: "s, strike, del" },
  code: { tag: "code", match: "code" },
  link: { tag: "a", match: "a" },
};
const SHORTCUTS: Record<string, FormatName | undefined> = { b: "bold", i: "italic", e: "code", "shift+x": "strike", k: "link" };
const HEADINGS = ["P", "H1", "H2", "H3"];
const MOD = /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl+";
// Pages with a CSS reset, such as Tailwind's preflight, style links as plain
// text, so a link added here would look as if nothing happened. Underline
// links in editable text then, only while the page is open here.
let linksChecked = false;
function checkLinkStyle(a: Element | null = document.querySelector("[data-id][contenteditable=true] a[href]")) {
  if (linksChecked || !a?.parentElement) return;
  linksChecked = true;
  const own = getComputedStyle(a);
  if (own.color === getComputedStyle(a.parentElement).color && !own.textDecorationLine.includes("underline")) {
    document.documentElement.classList.add("inplace-plain-links");
  }
}
checkLinkStyle();
const blockOf = (node: Node | null | undefined) =>
  (node?.nodeType === 1 ? node as Element : node?.parentElement)?.closest?.<HTMLElement>("[data-id][contenteditable=true]");

/** A selection inside one editable block. */
interface BlockRange {
  range: Range;
  block: HTMLElement;
}

function selectionInBlock() {
  const sel = getSelection()!;
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const block = blockOf(range.startContainer);
  if (!block || blockOf(range.endContainer) !== block) return null;
  return { sel, range, block };
}

// The formatted element the whole selection sits in, if any.
function activeAncestor(range: Range, block: HTMLElement, match: string) {
  const node = range.commonAncestorContainer;
  const el = (node.nodeType === 1 ? node as Element : node.parentElement!).closest<HTMLElement>(match);
  return el && el !== block && block.contains(el) ? el : null;
}

const isEmpty = (el: Element) => !el.textContent && !el.querySelector("br, img");

function select(first: Node, last: Node) {
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
}

// Wrap the selection in a formatting element, or take the formatting off if
// the selection is already inside one.
function applyFormat(ctx: BlockRange, name: FormatName, attrs: Record<string, string> | null = null) {
  const { range, block } = ctx;
  const { tag, match } = FORMATS[name];
  const active = activeAncestor(range, block, match);
  const inner: HTMLElement[] = [];
  if (active) for (let n = range.commonAncestorContainer.parentElement; n && n !== active; n = n.parentElement) inner.push(n);
  const frag = range.extractContents();
  for (const el of frag.querySelectorAll(match)) el.replaceWith(...el.childNodes);
  if (active && !attrs) {
    // Split the formatted element around the selection; the middle loses
    // this format but keeps any other formatting it was nested in.
    const tail = document.createRange();
    tail.setStart(range.startContainer, range.startOffset);
    tail.setEnd(active, active.childNodes.length);
    const after = active.cloneNode(false) as HTMLElement;
    after.append(tail.extractContents());
    let middle: Node = frag;
    for (const n of inner) {
      const wrap = n.cloneNode(false) as HTMLElement;
      wrap.append(middle);
      middle = wrap;
    }
    const nodes: Node[] = middle.nodeType === 11 ? [...middle.childNodes] : [middle];
    active.after(...nodes, after);
    if (isEmpty(after)) after.remove();
    if (isEmpty(active)) active.remove();
    if (nodes.length) select(nodes[0], nodes[nodes.length - 1]);
  } else {
    const el = active && attrs ? active : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (el !== active) {
      el.append(frag);
      range.insertNode(el);
    } else {
      range.insertNode(frag);
    }
    select(el, el);
    if (name === "link") checkLinkStyle(el);
  }
  schedule(block);
  updateToolbar();
}

function toggleFormat(name: FormatName) {
  const ctx = selectionInBlock();
  if (ctx && !ctx.range.collapsed) applyFormat(ctx, name);
}

// Typing Markdown applies the formatting as soon as the closing mark is typed.
const INLINE_MD: [RegExp, string, number][] = [
  [/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, "strong", 2],
  [/__([^_\s](?:[^_]*[^_\s])?)__$/, "strong", 2],
  [/~~([^~\s](?:[^~]*[^~\s])?)~~$/, "s", 2],
  [/`([^`]+)`$/, "code", 1],
  [/(?:^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, "em", 1],
  [/(?:^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, "em", 1],
];
let typedAfter: HTMLElement | null = null; // element just created from Markdown; the next character goes after it

function markdown(block: HTMLElement, typed: string | null) {
  const sel = getSelection()!;
  const node = sel.anchorNode as Text | null;
  if (!sel.isCollapsed || node?.nodeType !== 3 || !block.contains(node) || node.parentElement!.closest("code")) return;
  const before = node.data.slice(0, sel.anchorOffset);
  const heading = /^(#{1,3})[  ]$/.exec(before);
  if (heading && typed === " " && block.tagName === "P" && node === block.firstChild) {
    node.deleteData(0, heading[0].length);
    retag(block, `h${heading[1].length}`);
    return;
  }
  for (const [re, tag, d] of INLINE_MD) {
    const m = re.exec(before);
    if (!m) continue;
    const range = document.createRange();
    range.setStart(node, m.index + m[0].length - m[1].length - 2 * d);
    range.setEnd(node, sel.anchorOffset);
    range.deleteContents();
    const el = document.createElement(tag);
    el.textContent = m[1];
    range.insertNode(el);
    range.setStartAfter(el);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    typedAfter = el;
    return;
  }
}

// Browsers put the caret back inside the element just created, so the next
// character would be formatted too. Insert it after the element instead.
document.addEventListener("beforeinput", (e) => {
  const el = typedAfter;
  typedAfter = null;
  if (!el?.isConnected || e.inputType !== "insertText" || !e.data) return;
  const sel = getSelection()!;
  if (!sel.isCollapsed) return;
  const end = document.createRange();
  end.selectNodeContents(el);
  end.collapse(false);
  const at = sel.getRangeAt(0);
  const atEnd = at.compareBoundaryPoints(Range.START_TO_START, end) === 0 ||
    (at.startContainer === el.parentNode && at.startOffset === [...el.parentNode!.childNodes].indexOf(el) + 1);
  if (!atEnd) return;
  e.preventDefault();
  const text = document.createTextNode(e.data);
  el.after(text);
  const range = document.createRange();
  range.setStart(text, text.length);
  sel.removeAllRanges();
  sel.addRange(range);
  schedule(blockOf(el)!);
});

async function retag(el: HTMLElement, to: string) {
  const from = el.tagName.toLowerCase();
  if (from === to || !(await save(el))) return;
  const res = await post("retag", { id: el.dataset.id, from, to });
  if (res.ok) {
    rememberUndo("retag", el.dataset.id!);
    return reload();
  }
  showStatus("Couldn't change this paragraph. The page will reload with the file's version.", "error", true);
  setTimeout(reload, 1800);
}

const formatToolbar = document.createElement("div");
formatToolbar.id = "inplace-toolbar";
formatToolbar.dataset.inplaceUi = "";
formatToolbar.innerHTML = `
  <button type="button" data-format="bold" title="Bold (${MOD}B)"><b>B</b></button>
  <button type="button" data-format="italic" title="Italic (${MOD}I)"><i>I</i></button>
  <button type="button" data-format="strike" title="Strikethrough (${MOD}Shift+X)"><s>S</s></button>
  <button type="button" data-format="code" title="Code (${MOD}E)" style="font-family:ui-monospace,monospace">&lt;/&gt;</button>
  <button type="button" data-format="link" title="Link (${MOD}K)">Link</button>
  <span class="sep" data-headings></span>
  <button type="button" data-tag="p" data-headings title="Normal text">Text</button>
  <button type="button" data-tag="h1" data-headings title="Large heading (type # and a space)">H1</button>
  <button type="button" data-tag="h2" data-headings title="Medium heading (type ## and a space)">H2</button>
  <button type="button" data-tag="h3" data-headings title="Small heading (type ### and a space)">H3</button>
  <form><input type="text" placeholder="Paste a link, or leave empty to remove it" aria-label="Link address"><button type="submit">Apply</button></form>`;
document.body.append(formatToolbar);
const linkInput = formatToolbar.querySelector("input")!;
let linking: { block: HTMLElement; range: Range; existing: HTMLElement | null } | null = null; // while the link field is open

// Clicking the toolbar must not take the selection away from the text.
formatToolbar.addEventListener("mousedown", (e) => {
  if (e.target !== linkInput) e.preventDefault();
});
formatToolbar.addEventListener("click", (e) => {
  const button = (e.target as Element).closest<HTMLButtonElement>("button[type=button]");
  if (!button) return;
  if (button.dataset.format === "link") return startLink();
  if (button.dataset.format) return toggleFormat(button.dataset.format as FormatName);
  const ctx = selectionInBlock();
  if (ctx && button.dataset.tag) retag(ctx.block, button.dataset.tag);
});

function startLink() {
  const ctx = selectionInBlock();
  if (!ctx) return;
  const existing = activeAncestor(ctx.range, ctx.block, "a");
  if (ctx.range.collapsed && !existing) return;
  linking = { block: ctx.block, range: ctx.range.cloneRange(), existing };
  linkInput.value = existing?.getAttribute("href") || "";
  formatToolbar.classList.add("linking");
  showToolbar(ctx.range);
  linkInput.focus();
  linkInput.select();
}

// What to write as the link's address: relative addresses as typed, a bare
// domain with https:// and an email address with mailto: added. Null for
// any other scheme, such as javascript: or data:, which the file shouldn't get.
const LINK_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);
function normalizeHref(value: string) {
  let href = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!href || /^(#|\/|\.\.?\/|\?)/.test(href)) return href;
  // "localhost:3000/x" starts with a host and port, not a scheme.
  const hostPort = /^[^:/?#]+:\d+([/?#]|$)/.test(href) && !/^tel:/i.test(href);
  if (!/^[a-z][\w+.-]*:/i.test(href) || hostPort) href = (href.includes("@") && !href.includes("/") ? "mailto:" : "https://") + href;
  try {
    return LINK_SCHEMES.has(new URL(href, "https://relative.invalid").protocol) ? href : null;
  } catch {
    return null;
  }
}

function endLink(apply: boolean) {
  const state = linking;
  linking = null;
  formatToolbar.classList.remove("linking");
  if (!state) return;
  state.block.focus({ preventScroll: true });
  const sel = getSelection()!;
  sel.removeAllRanges();
  if (state.existing && state.range.collapsed) state.range.selectNodeContents(state.existing);
  sel.addRange(state.range);
  if (!apply) return updateToolbar();
  const href = normalizeHref(linkInput.value);
  if (href === null) return showStatus("Links can start with http, https, mailto or tel", "error", 4000);
  const ctx = { range: state.range, block: state.block };
  if (href) applyFormat(ctx, "link", { href });
  else if (state.existing) applyFormat(ctx, "link");
}

formatToolbar.querySelector("form")!.addEventListener("submit", (e) => {
  e.preventDefault();
  endLink(true);
});
linkInput.addEventListener("keydown", (e) => {
  if (composing(e)) return;
  if (e.key === "Enter") {
    e.preventDefault();
    endLink(true);
  } else if (e.key === "Escape") {
    e.preventDefault();
    endLink(false);
  }
});
linkInput.addEventListener("blur", () => setTimeout(() => linking && endLink(false), 150));

function showToolbar(range: Range) {
  formatToolbar.style.display = "flex";
  const r = range.getBoundingClientRect();
  const w = formatToolbar.offsetWidth;
  const h = formatToolbar.offsetHeight;
  const top = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8;
  formatToolbar.style.top = `${top}px`;
  formatToolbar.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
}

// Where the person can't edit, selecting text offers only Comment.
function updateCommentToolbar() {
  const sel = getSelection()!;
  const range = canComment && sel.rangeCount && !sel.isCollapsed && !drag ? sel.getRangeAt(0) : null;
  const node = range?.commonAncestorContainer;
  const inText = (node?.nodeType === 1 ? node as Element : node?.parentElement)?.closest?.("[data-id]");
  if (!range || !inText || inText.closest("[data-inplace-ui]")) {
    formatToolbar.style.display = "none";
    return;
  }
  formatToolbar.classList.add("comment-only");
  showToolbar(range);
}

function updateToolbar() {
  if (linking) return;
  if (!canEdit) return updateCommentToolbar();
  const ctx = selectionInBlock();
  if (!ctx || ctx.range.collapsed || drag) {
    formatToolbar.style.display = "none";
    return;
  }
  for (const button of formatToolbar.querySelectorAll<HTMLElement>("[data-format]")) {
    const f = FORMATS[button.dataset.format as FormatName];
    button.setAttribute("aria-pressed", String(!!activeAncestor(ctx.range, ctx.block, f.match)));
  }
  const headings = HEADINGS.includes(ctx.block.tagName);
  for (const el of formatToolbar.querySelectorAll<HTMLElement>("[data-headings]")) el.style.display = headings ? "" : "none";
  for (const button of formatToolbar.querySelectorAll<HTMLElement>("[data-tag]")) {
    button.setAttribute("aria-pressed", String(button.dataset.tag === ctx.block.tagName.toLowerCase()));
  }
  showToolbar(ctx.range);
}
document.addEventListener("selectionchange", updateToolbar);
addEventListener("scroll", updateToolbar, { passive: true, capture: true });
