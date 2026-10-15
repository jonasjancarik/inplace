// In-place editing for one HTML document served by `inplace`.
// Only blocks the server marked with data-id are editable, and only their text:
// structure, styling and generated parts stay as they are in the file.
(() => {
  const script = document.currentScript;
  let version = script.dataset.version;
  const STATE_KEY = `inplace:${script.dataset.file}`;
  const SAVE_DELAY = 600;
  const INLINE_OK = new Set(["A", "B", "STRONG", "I", "EM", "U", "S", "SUB", "SUP", "SPAN", "BR", "CODE", "SMALL", "MARK", "ABBR", "TIME"]);

  // --- status pill (kept out of print and out of the document's own flow) ---
  const style = document.createElement("style");
  style.dataset.inplaceUi = "";
  style.textContent = `
    [data-id][contenteditable]{outline:none;border-radius:2px;transition:box-shadow .15s}
    [data-id][contenteditable]:hover{box-shadow:0 0 0 2px #4a7bd433}
    [data-id][contenteditable]:focus{box-shadow:0 0 0 2px #4a7bd4aa}
    [data-id].inplace-conflict{box-shadow:0 0 0 2px #d4734a!important}
    #inplace-status{position:fixed;right:14px;bottom:14px;z-index:2147483647;font:12px/1.3 -apple-system,system-ui,sans-serif;
      background:#1f2a24;color:#fff;padding:7px 11px;border-radius:7px;box-shadow:0 3px 12px #0003;max-width:340px;opacity:.88}
    #inplace-status[data-kind=error]{background:#9c3b1c}
    @media print{#inplace-status{display:none!important}[data-id][contenteditable]{box-shadow:none!important}}`;
  document.head.append(style);

  const pill = document.createElement("div");
  pill.id = "inplace-status";
  pill.dataset.inplaceUi = "";
  document.body.append(pill);
  let pillTimer;
  function status(text, kind = "info", sticky = false) {
    pill.textContent = text;
    pill.dataset.kind = kind;
    pill.style.display = "";
    clearTimeout(pillTimer);
    if (!sticky) pillTimer = setTimeout(() => (pill.style.display = "none"), 2500);
  }
  pill.style.display = "none";

  // --- per-block state: the HTML last known to match the file ---
  const saved = new Map(); // id -> innerHTML as last saved / loaded
  const timers = new Map();

  // Containers (tables, rows, figures) also carry a data-id so comments on
  // them can be traced, but only text blocks are editable.
  const editable = new Set((script.dataset.editable || "").split(" "));
  const blocks = [...document.querySelectorAll("[data-id]")].filter(
    (el) => editable.has(el.dataset.id) && !el.closest("svg, nav, [data-locked], [contenteditable=false]")
  );
  for (const el of blocks) {
    el.contentEditable = "true";
    el.spellcheck = true;
    saved.set(el.dataset.id, el.innerHTML);
  }

  // Undo the markup browsers add while typing: <div> line wraps, <font>,
  // style attributes and empty spans. Existing inline markup is kept.
  function clean(el) {
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

  async function save(el) {
    const id = el.dataset.id;
    clearTimeout(timers.get(id));
    timers.delete(id);
    clean(el);
    const html = el.innerHTML;
    if (html === saved.get(id)) return true;
    status("Saving…", "info", true);
    try {
      const res = await fetch("/__inplace/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, old: saved.get(id), new: html }),
      });
      const body = await res.json();
      if (res.ok) {
        saved.set(id, html);
        version = body.version;
        el.classList.remove("inplace-conflict");
        status("Saved");
        return true;
      }
      if (res.status === 409) {
        // The agent changed this same block. Keep both: show the file's
        // version, and park the user's text so it can be pasted back.
        el.classList.add("inplace-conflict");
        rememberConflict(id, el.innerText);
        status("This paragraph was changed in the file while you were typing. Your text is copied to the clipboard; the page will now show the file's version.", "error", true);
        try { await navigator.clipboard.writeText(el.innerText); } catch {}
        setTimeout(reload, 1800);
        return false;
      }
      status(`Couldn't save: ${body.error || res.status}`, "error", true);
    } catch (e) {
      status("Couldn't reach the editor server. Your edits are still on the page.", "error", true);
    }
    return false;
  }

  function schedule(el) {
    clearTimeout(timers.get(el.dataset.id));
    timers.set(el.dataset.id, setTimeout(() => save(el), SAVE_DELAY));
  }

  document.addEventListener("input", (e) => {
    const el = e.target.closest?.("[data-id][contenteditable=true]");
    if (el) schedule(el);
  });
  document.addEventListener("focusout", (e) => {
    const el = e.target.closest?.("[data-id][contenteditable=true]");
    if (el) save(el);
  });
  document.addEventListener("keydown", (e) => {
    const el = e.target.closest?.("[data-id][contenteditable=true]");
    if (!el) return;
    if (e.key === "Enter" && !e.shiftKey) {
      // New paragraphs would need new blocks in the file; ask the agent for those.
      e.preventDefault();
      el.blur();
    }
    if (e.key === "Escape") el.blur();
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      save(el);
    }
  });
  document.addEventListener("paste", (e) => {
    if (!e.target.closest?.("[data-id][contenteditable=true]")) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " ");
    document.execCommand("insertText", false, text);
  });
  // Links inside editable text should be editable, not followed.
  document.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-id][contenteditable=true] a") && !(e.metaKey || e.ctrlKey)) e.preventDefault();
  });

  // --- live reload when the file changes on disk (agent edits) ---
  function rememberConflict(id, text) {
    try { sessionStorage.setItem(`${STATE_KEY}:conflict`, JSON.stringify({ id, text })); } catch {}
  }

  async function reload() {
    for (const id of pending()) {
      const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (el && !(await save(el))) return; // a conflict reloads on its own
    }
    const active = document.activeElement?.closest?.("[data-id]");
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({ x: scrollX, y: scrollY, focus: active?.dataset.id }));
    } catch {}
    location.reload();
  }

  function restore() {
    let state;
    try { state = JSON.parse(sessionStorage.getItem(STATE_KEY) || "null"); sessionStorage.removeItem(STATE_KEY); } catch {}
    if (state) {
      scrollTo(state.x, state.y);
      const el = state.focus && document.querySelector(`[data-id="${CSS.escape(state.focus)}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      }
    }
    let conflict;
    try { conflict = JSON.parse(sessionStorage.getItem(`${STATE_KEY}:conflict`) || "null"); sessionStorage.removeItem(`${STATE_KEY}:conflict`); } catch {}
    if (conflict) {
      const el = document.querySelector(`[data-id="${CSS.escape(conflict.id)}"]`);
      el?.classList.add("inplace-conflict");
      status("Showing the file's version of the highlighted paragraph. Your own text is on the clipboard.", "error", true);
    }
  }
  restore();

  const events = new EventSource("/__inplace/events");
  events.addEventListener("version", (e) => {
    if (e.data !== version) reload();
  });
  events.onerror = () => status("Lost connection to the editor server. Reconnecting…", "error", true);
  events.onopen = () => { if (pill.dataset.kind === "error" && pill.textContent.startsWith("Lost")) status("Reconnected"); };
})();
