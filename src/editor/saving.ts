// Undo the markup browsers add while typing: <div> line wraps, <font>,
// style attributes and empty spans. Existing inline markup is kept.
function clean(el: HTMLElement) {
  for (const node of [...el.querySelectorAll("*")]) {
    if (node.tagName === "DIV" || node.tagName === "P") {
      node.before(document.createElement("br"));
      node.replaceWith(...node.childNodes);
    } else if (node.tagName === "FONT" || !INLINE_OK.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
    } else {
      node.removeAttribute("style");
      if (node.tagName === "SPAN" && node.attributes.length === 0) node.replaceWith(...node.childNodes);
    }
  }
  const last = el.lastChild;
  if (last && last.nodeName === "BR" && el.childNodes.length > 1) last.remove();
}

const pending = () => [...timers.keys()];

// Chrome types a space next to a formatting tag as &nbsp; and never turns it
// back. Make those ordinary spaces again, but only inside the part of the
// block that just changed, so deliberate non-breaking spaces stay.
function tidySpaces(before: string | undefined, after: string) {
  if (before === undefined || !after.includes("&nbsp;")) return after;
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const a = Math.max(0, p - 6), b = Math.min(after.length, after.length - s + 6);
  const mid = after.slice(a, b)
    .replace(/(?<!<br>)>&nbsp;(?=[^\s<&])/g, "> ")
    .replace(/([^\s>;])&nbsp;(?=<)/g, "$1 ");
  return after.slice(0, a) + mid + after.slice(b);
}

async function save(el: HTMLElement): Promise<boolean> {
  const id = el.dataset.id!;
  clearTimeout(timers.get(id));
  timers.delete(id);
  clean(el);
  const html = tidySpaces(saved.get(id), el.innerHTML);
  if (html === saved.get(id)) return true;
  showStatus("Saving…", "info", true);
  {
    const { ok, status: code, body } = await post("save", { id, old: saved.get(id), new: html });
    if (code === 0) {
      showStatus("Couldn't reach the editor server. Your edits are still on the page.", "error", true);
      return false;
    }
    const res = { ok, status: code };
    if (res.ok) {
      saved.set(id, html);
      version = body.version;
      el.classList.remove("inplace-conflict");
      if (body.merged) {
        // The file had a newer version of this block; the server combined
        // both. Show the combined text.
        showStatus("Saved. Your agent changed this paragraph too, so both changes were combined.");
        setTimeout(reload, 600);
      } else showStatus("Saved");
      return true;
    }
    if (res.status === 409) {
      // The file's version of this block changed in the same words. The
      // server kept the user's version in its stash; show the file's.
      el.classList.add("inplace-conflict");
      rememberConflict(id);
      showStashCount(body.stash);
      showStatus("Your agent changed the same words while you were typing. Your version is kept under \u201cSet aside\u201d at the bottom left.", "error", true);
      setTimeout(reload, 2200);
      return false;
    }
    showStatus(`Couldn't save: ${body.error || res.status}`, "error", true);
  }
  return false;
}

// While a request is out, a version announced by the server may be our own
// change; wait for the reply before deciding whether to reload.
let busy = 0;
let announced: string | null = null; // a version the server announced while a request was out

async function post(action: string, payload: object): Promise<{ ok: boolean; status: number; body: Reply }> {
  busy++;
  try {
    const body = JSON.stringify(payload);
    const res = await fetch(`/__inplace/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // A hidden tab may be closed before the reply comes; let the request finish anyway.
      keepalive: document.hidden && fits(body),
    });
    return { ok: res.ok, status: res.status, body: await res.json() };
  } catch {
    return { ok: false, status: 0, body: {} };
  } finally {
    busy--;
    if (!busy) setTimeout(() => {
      if (busy || announced === null) return;
      const seen = announced;
      announced = null;
      if (seen !== version) reload();
    }, 0);
  }
}

function schedule(el: HTMLElement) {
  clearTimeout(timers.get(el.dataset.id!));
  timers.set(el.dataset.id!, setTimeout(() => save(el), SAVE_DELAY));
}

document.addEventListener("input", (e) => {
  const el = (e.target as Element).closest?.<HTMLElement>("[data-id][contenteditable=true]");
  if (!el) return;
  if ((e as InputEvent).inputType === "insertText") markdown(el, (e as InputEvent).data);
  schedule(el);
});
// Browsers cap requests that outlive the page at 64 KB in total.
const fits = (body: string) => new Blob([body]).size < 60_000;

// Closing, reloading or leaving the page doesn't wait for a pending save, so
// send what's left with keepalive, which outlives the page. The reply can't
// be handled; a clash with the agent is set aside on the server as usual.
addEventListener("pagehide", () => {
  for (const id of pending()) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    const el = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (!el) continue;
    clean(el);
    const html = tidySpaces(saved.get(id), el.innerHTML);
    if (html === saved.get(id)) continue;
    const body = JSON.stringify({ id, old: saved.get(id), new: html });
    if (!fits(body)) continue;
    fetch("/__inplace/save", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body })
      .catch(() => {});
    saved.set(id, html);
  }
});
// Mobile browsers often discard a hidden tab without a pagehide, so save
// pending blocks as soon as the tab is hidden.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) return;
  for (const id of pending()) {
    const el = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (el) save(el);
  }
});
document.addEventListener("focusout", (e) => {
  const el = (e.target as Element).closest?.<HTMLElement>("[data-id][contenteditable=true]");
  if (el) save(el);
});
// While an input method (Japanese, Chinese, Korean…) is building a word,
// Enter and Escape belong to it. Safari sends the confirming Enter after
// compositionend, so isComposing is already false there; keyCode 229 marks it.
const composing = (e: KeyboardEvent) => e.isComposing || e.keyCode === 229;

document.addEventListener("keydown", (e) => {
  const el = (e.target as Element).closest?.<HTMLElement>("[data-id][contenteditable=true]");
  if (!el || composing(e)) return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (SPLITTABLE.has(el.tagName)) splitBlock(el);
    else el.blur(); // a table cell or caption: Enter just leaves it
  }
  if (e.key === "Backspace" && isBlankEl(el)) {
    const target: HTMLElement | null = /^T[DH]$/.test(el.tagName) ? el.closest("tr") : el;
    if (target?.dataset.id && [...target.querySelectorAll<HTMLElement>("[contenteditable=true]")].concat(target).every(isBlankEl)) {
      e.preventDefault();
      removeEmpty(target);
    }
  }
  if (e.key === "Escape") el.blur();
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    save(el);
  }
  const shortcut = (e.metaKey || e.ctrlKey) && !e.altKey && SHORTCUTS[(e.shiftKey ? "shift+" : "") + e.key.toLowerCase()];
  if (shortcut) {
    e.preventDefault();
    shortcut === "link" ? startLink() : toggleFormat(shortcut);
  }
});
document.addEventListener("paste", (e) => {
  if (!(e.target as Element).closest?.("[data-id][contenteditable=true]")) return;
  e.preventDefault();
  const text = e.clipboardData!.getData("text/plain").replace(/\s*\n\s*/g, " ");
  document.execCommand("insertText", false, text);
});
// Links inside editable text should be editable, not followed.
document.addEventListener("click", (e) => {
  if ((e.target as Element).closest?.("[data-id][contenteditable=true] a") && !(e.metaKey || e.ctrlKey)) e.preventDefault();
});
