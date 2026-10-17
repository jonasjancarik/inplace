// --- adding and removing paragraphs, list items and rows ---
// A new element copies the start tags of its siblings (the server picks the
// most common pattern), so it looks like its neighbours and never brings
// markup of its own.
const SPLITTABLE = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "DT", "DD"]);
const INSERTABLE = new Set([...SPLITTABLE, "TR"]);
const isHeading = (el: Element) => /^H\d$/.test(el.tagName);
const isBlankEl = (el: Element) => !el.textContent!.trim() && !el.querySelector("img, svg, video, iframe, canvas");
const isBlankRange = (r: Range) => !r.toString().trim() && !r.cloneContents().querySelector("img, svg, video, iframe, canvas");

function caretTo(el: HTMLElement | null | undefined, where: "start" | "end") {
  if (!el) return;
  el.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(where === "start");
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
  el.scrollIntoView({ block: "nearest" });
}

function applyLists(body: Reply) {
  if (body.editable) editable = new Set(body.editable);
  if (body.movable) movable = new Set(body.movable);
}

async function insertNear(el: HTMLElement, { position = "after", tag, content = "", split = null }: {
  position?: "before" | "after"; tag: string; content?: string; split?: string | null;
}) {
  const id = el.dataset.id!;
  const payload = { id, position, tag, content };
  if (split !== null) Object.assign(payload, { old: saved.get(id), new: split });
  const res = await post("insert", payload);
  if (!res.ok) {
    showStatus("Couldn't add this here, probably because the file changed in the meantime. The page will reload.", "error", true);
    return setTimeout(reload, 1800);
  }
  version = res.body.version;
  if (!content) rememberUndo("add", res.body.id!);
  if (split !== null) saved.set(id, split);
  applyLists(res.body);
  const range = document.createRange();
  range.selectNodeContents(el.parentElement!);
  const added = range.createContextualFragment(res.body.html!).firstElementChild as HTMLElement;
  el[position](added);
  makeEditable(added);
  caretTo(editable.has(added.dataset.id!) ? added : added.querySelector<HTMLElement>("[contenteditable=true]"), "start");
  showStatus("Added");
}

// Enter in a paragraph, heading or list item: the text after the caret moves
// to a new element of the same kind. At the end of a heading, the new
// element is a paragraph.
function splitBlock(el: HTMLElement) {
  const sel = getSelection()!;
  if (!sel.rangeCount) return;
  const at = sel.getRangeAt(0);
  if (!at.collapsed) at.deleteContents();
  clearTimeout(timers.get(el.dataset.id!));
  timers.delete(el.dataset.id!);
  const head = document.createRange();
  head.setStart(el, 0);
  head.setEnd(at.startContainer, at.startOffset);
  const tail = document.createRange();
  tail.setStart(at.startContainer, at.startOffset);
  tail.setEnd(el, el.childNodes.length);
  const own = el.tagName.toLowerCase();
  if (isBlankRange(head) && !isBlankRange(tail)) {
    // At the start of the text: open a new, empty one above.
    return insertNear(el, { position: "before", tag: isHeading(el) ? "p" : own, split: changed(el) });
  }
  const blankTail = isBlankRange(tail);
  const box = document.createElement("div");
  box.append(tail.extractContents());
  // The space after a full stop belongs to neither half.
  const lead = box.firstChild as Text | null, end = el.lastChild as Text | null;
  if (lead?.nodeType === 3) lead.data = lead.data.replace(/^[ \t\n]+/, "");
  if (end?.nodeType === 3) end.data = end.data.replace(/[ \t\n]+$/, "");
  clean(el);
  insertNear(el, {
    tag: isHeading(el) && blankTail ? "p" : own,
    content: blankTail ? "" : box.innerHTML,
    split: el.innerHTML,
  });
}

function changed(el: HTMLElement) {
  clean(el);
  return el.innerHTML === saved.get(el.dataset.id!) ? null : el.innerHTML;
}

// Backspace in a paragraph, item or row with nothing left in it removes it.
async function removeEmpty(el: HTMLElement) {
  const blocks = [...document.querySelectorAll<HTMLElement>("[contenteditable=true]")];
  const previous = blocks.filter((b) => !el.contains(b) && b.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
  // The server only removes what's empty in the file, so text deleted a
  // moment ago has to be saved first.
  for (const b of [el, ...el.querySelectorAll<HTMLElement>("[data-id]")]) {
    if (timers.has(b.dataset.id!) && !(await save(b))) return;
  }
  const res = await post("remove", { id: el.dataset.id });
  if (!res.ok) {
    showStatus("Couldn't remove this, probably because the file changed in the meantime. The page will reload.", "error", true);
    return setTimeout(reload, 1800);
  }
  version = res.body.version;
  applyLists(res.body);
  rememberUndo("remove", el.dataset.id!);
  el.remove();
  caretTo(previous, "end");
}
