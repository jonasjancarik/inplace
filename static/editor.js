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
    .inplace-grip{position:fixed;z-index:2147483646;width:18px;height:22px;padding:0;margin:0;border:0;border-radius:4px;
      background:#fff;color:#7a8580;box-shadow:0 1px 4px #0002;font:14px/22px system-ui,sans-serif;letter-spacing:-3px;
      text-align:center;cursor:grab;user-select:none;touch-action:none}
    .inplace-grip:hover{color:#1f2a24;background:#eef2fb}
    #inplace-outline{position:fixed;z-index:2147483645;pointer-events:none;border:2px solid #4a7bd4aa;border-radius:3px}
    #inplace-marker{position:fixed;z-index:2147483646;pointer-events:none;background:#4a7bd4;border-radius:2px}
    .inplace-dragging{opacity:.35}
    html.inplace-is-dragging,html.inplace-is-dragging *{cursor:grabbing!important;user-select:none!important}
    #inplace-toolbar{position:fixed;z-index:2147483647;display:none;align-items:center;gap:2px;padding:3px;border-radius:8px;
      background:#1f2a24;box-shadow:0 3px 12px #0004;font:13px/1 -apple-system,system-ui,sans-serif}
    #inplace-toolbar button{all:unset;box-sizing:border-box;min-width:28px;height:28px;padding:0 7px;border-radius:5px;
      color:#e8ece9;text-align:center;line-height:28px;cursor:pointer;font:inherit}
    #inplace-toolbar button:hover{background:#ffffff1f}
    #inplace-toolbar button[aria-pressed=true]{background:#ffffff33;color:#fff}
    #inplace-toolbar .sep{width:1px;height:18px;margin:0 4px;background:#ffffff33}
    #inplace-toolbar form{display:none;gap:4px;margin:0}
    #inplace-toolbar input{all:unset;box-sizing:border-box;width:240px;height:28px;padding:0 8px;border-radius:5px;
      background:#fff;color:#1f2a24;font:inherit}
    #inplace-toolbar.linking > :not(form){display:none}
    #inplace-toolbar.linking form{display:flex}
    @media print{#inplace-status,#inplace-ui,#inplace-toolbar{display:none!important}[data-id][contenteditable]{box-shadow:none!important}}`;
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

  async function post(action, payload) {
    try {
      const res = await fetch(`/__inplace/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { ok: res.ok, status: res.status, body: await res.json() };
    } catch {
      return { ok: false, status: 0, body: {} };
    }
  }

  function schedule(el) {
    clearTimeout(timers.get(el.dataset.id));
    timers.set(el.dataset.id, setTimeout(() => save(el), SAVE_DELAY));
  }

  document.addEventListener("input", (e) => {
    const el = e.target.closest?.("[data-id][contenteditable=true]");
    if (!el) return;
    if (e.inputType === "insertText") markdown(el, e.data);
    schedule(el);
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
    const shortcut = (e.metaKey || e.ctrlKey) && !e.altKey && SHORTCUTS[(e.shiftKey ? "shift+" : "") + e.key.toLowerCase()];
    if (shortcut) {
      e.preventDefault();
      shortcut === "link" ? startLink() : toggleFormat(shortcut);
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

  // --- formatting: bold, italic, strikethrough, code, links, headings ---
  const FORMATS = {
    bold: { tag: "strong", match: "strong, b" },
    italic: { tag: "em", match: "em, i" },
    strike: { tag: "s", match: "s, strike, del" },
    code: { tag: "code", match: "code" },
    link: { tag: "a", match: "a" },
  };
  const SHORTCUTS = { b: "bold", i: "italic", e: "code", "shift+x": "strike", k: "link" };
  const HEADINGS = ["P", "H1", "H2", "H3"];
  const MOD = /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const blockOf = (node) =>
    (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.("[data-id][contenteditable=true]");

  function selectionInBlock() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const block = blockOf(range.startContainer);
    if (!block || blockOf(range.endContainer) !== block) return null;
    return { sel, range, block };
  }

  // The formatted element the whole selection sits in, if any.
  function activeAncestor(range, block, match) {
    const node = range.commonAncestorContainer;
    const el = (node.nodeType === 1 ? node : node.parentElement).closest(match);
    return el && el !== block && block.contains(el) ? el : null;
  }

  const isEmpty = (el) => !el.textContent && !el.querySelector("br, img");

  function select(first, last) {
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }

  // Wrap the selection in a formatting element, or take the formatting off if
  // the selection is already inside one.
  function applyFormat(ctx, name, attrs = null) {
    const { range, block } = ctx;
    const { tag, match } = FORMATS[name];
    const active = activeAncestor(range, block, match);
    const inner = [];
    if (active) for (let n = range.commonAncestorContainer.parentElement; n && n !== active; n = n.parentElement) inner.push(n);
    const frag = range.extractContents();
    for (const el of frag.querySelectorAll(match)) el.replaceWith(...el.childNodes);
    if (active && !attrs) {
      // Split the formatted element around the selection; the middle loses
      // this format but keeps any other formatting it was nested in.
      const tail = document.createRange();
      tail.setStart(range.startContainer, range.startOffset);
      tail.setEnd(active, active.childNodes.length);
      const after = active.cloneNode(false);
      after.append(tail.extractContents());
      let middle = frag;
      for (const n of inner) {
        const wrap = n.cloneNode(false);
        wrap.append(middle);
        middle = wrap;
      }
      const nodes = middle.nodeType === 11 ? [...middle.childNodes] : [middle];
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
    }
    schedule(block);
    updateToolbar();
  }

  function toggleFormat(name) {
    const ctx = selectionInBlock();
    if (ctx && !ctx.range.collapsed) applyFormat(ctx, name);
  }

  // Typing Markdown applies the formatting as soon as the closing mark is typed.
  const INLINE_MD = [
    [/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, "strong", 2],
    [/__([^_\s](?:[^_]*[^_\s])?)__$/, "strong", 2],
    [/~~([^~\s](?:[^~]*[^~\s])?)~~$/, "s", 2],
    [/`([^`]+)`$/, "code", 1],
    [/(?:^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, "em", 1],
    [/(?:^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, "em", 1],
  ];
  let typedAfter = null; // element just created from Markdown; the next character goes after it

  function markdown(block, typed) {
    const sel = getSelection();
    const node = sel.anchorNode;
    if (!sel.isCollapsed || node?.nodeType !== 3 || !block.contains(node) || node.parentElement.closest("code")) return;
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
    const sel = getSelection();
    if (!sel.isCollapsed) return;
    const end = document.createRange();
    end.selectNodeContents(el);
    end.collapse(false);
    const at = sel.getRangeAt(0);
    const atEnd = at.compareBoundaryPoints(Range.START_TO_START, end) === 0 ||
      (at.startContainer === el.parentNode && at.startOffset === [...el.parentNode.childNodes].indexOf(el) + 1);
    if (!atEnd) return;
    e.preventDefault();
    const text = document.createTextNode(e.data);
    el.after(text);
    const range = document.createRange();
    range.setStart(text, text.length);
    sel.removeAllRanges();
    sel.addRange(range);
    schedule(blockOf(el));
  });

  async function retag(el, to) {
    const from = el.tagName.toLowerCase();
    if (from === to || !(await save(el))) return;
    const res = await post("retag", { id: el.dataset.id, from, to });
    if (res.ok) return reload();
    status("Couldn't change this paragraph. The page will reload with the file's version.", "error", true);
    setTimeout(reload, 1800);
  }

  const toolbar = document.createElement("div");
  toolbar.id = "inplace-toolbar";
  toolbar.dataset.inplaceUi = "";
  toolbar.innerHTML = `
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
  document.body.append(toolbar);
  const linkInput = toolbar.querySelector("input");
  let linking = null; // { block, range, existing } while the link field is open

  // Clicking the toolbar must not take the selection away from the text.
  toolbar.addEventListener("mousedown", (e) => {
    if (e.target !== linkInput) e.preventDefault();
  });
  toolbar.addEventListener("click", (e) => {
    const button = e.target.closest("button[type=button]");
    if (!button) return;
    if (button.dataset.format === "link") return startLink();
    if (button.dataset.format) return toggleFormat(button.dataset.format);
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
    toolbar.classList.add("linking");
    showToolbar(ctx.range);
    linkInput.focus();
    linkInput.select();
  }

  function endLink(apply) {
    const state = linking;
    linking = null;
    toolbar.classList.remove("linking");
    if (!state) return;
    state.block.focus({ preventScroll: true });
    const sel = getSelection();
    sel.removeAllRanges();
    if (state.existing && state.range.collapsed) state.range.selectNodeContents(state.existing);
    sel.addRange(state.range);
    if (!apply) return updateToolbar();
    let href = linkInput.value.trim();
    if (href && !/^([a-z][\w+.-]*:|[#/?.])/i.test(href)) href = (href.includes("@") ? "mailto:" : "https://") + href;
    const ctx = { range: state.range, block: state.block };
    if (href) applyFormat(ctx, "link", { href });
    else if (state.existing) applyFormat(ctx, "link");
  }

  toolbar.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    endLink(true);
  });
  linkInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      endLink(false);
    }
  });
  linkInput.addEventListener("blur", () => setTimeout(() => linking && endLink(false), 150));

  function showToolbar(range) {
    toolbar.style.display = "flex";
    const r = range.getBoundingClientRect();
    const w = toolbar.offsetWidth;
    const h = toolbar.offsetHeight;
    const top = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8;
    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  }

  function updateToolbar() {
    if (linking) return;
    const ctx = selectionInBlock();
    if (!ctx || ctx.range.collapsed || drag) {
      toolbar.style.display = "none";
      return;
    }
    for (const button of toolbar.querySelectorAll("[data-format]")) {
      const f = FORMATS[button.dataset.format];
      button.setAttribute("aria-pressed", String(!!activeAncestor(ctx.range, ctx.block, f.match)));
    }
    const headings = HEADINGS.includes(ctx.block.tagName);
    for (const el of toolbar.querySelectorAll("[data-headings]")) el.style.display = headings ? "" : "none";
    for (const button of toolbar.querySelectorAll("[data-tag]")) {
      button.setAttribute("aria-pressed", String(button.dataset.tag === ctx.block.tagName.toLowerCase()));
    }
    showToolbar(ctx.range);
  }
  document.addEventListener("selectionchange", updateToolbar);
  addEventListener("scroll", updateToolbar, { passive: true, capture: true });

  // --- dragging an element to another place among its siblings ---
  const movable = new Set((script.dataset.movable || "").split(" ").filter(Boolean));
  const isMovable = (el) => !!el.dataset?.id && movable.has(el.dataset.id) && !el.closest("[data-locked]");
  const siblingsOf = (el) => [...el.parentElement.children].filter((s) => s !== el && isMovable(s));
  const NAMES = {
    P: "paragraph", LI: "list item", TR: "row", TABLE: "table", FIGURE: "figure", SECTION: "section",
    UL: "list", OL: "list", DL: "list", BLOCKQUOTE: "quote", ARTICLE: "section", ASIDE: "box",
  };
  const nameOf = (el) => NAMES[el.tagName] || (/^H\d$/.test(el.tagName) ? "heading" : "block");

  const ui = document.createElement("div");
  ui.id = "inplace-ui";
  ui.dataset.inplaceUi = "";
  document.body.append(ui);
  let grips = []; // elements showing a grip, innermost first
  let hoverTimer = null;
  let drag = null;

  function chainAt(node) {
    const chain = [];
    for (let el = node; el && el !== document.body; el = el.parentElement) {
      if (isMovable(el) && siblingsOf(el).length) chain.push(el);
    }
    return chain.slice(0, 3);
  }

  function outline(el) {
    let box = document.getElementById("inplace-outline");
    if (!el) return box?.remove();
    if (!box) {
      box = document.createElement("div");
      box.id = "inplace-outline";
      ui.append(box);
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
  }

  function showGrips(chain) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    grips = chain;
    ui.replaceChildren();
    chain.forEach((el, depth) => {
      const r = el.getBoundingClientRect();
      const grip = document.createElement("button");
      grip.type = "button";
      grip.className = "inplace-grip";
      grip.dataset.index = depth;
      grip.title = `Drag to move this ${nameOf(el)}`;
      grip.setAttribute("aria-label", grip.title);
      grip.textContent = "⋮⋮";
      // List items keep their bullet or number clear of the grip.
      const gutter = el.tagName === "LI" ? 40 : 24;
      grip.style.left = `${Math.max(2, r.left - gutter - depth * 22)}px`;
      grip.style.top = `${Math.max(2, r.top + Math.min(2, r.height / 2 - 11))}px`;
      grip.addEventListener("mouseenter", () => outline(el));
      grip.addEventListener("mouseleave", () => drag || outline(null));
      ui.append(grip);
    });
  }

  const sameChain = (a, b) => a.length === b.length && a.every((el, i) => el === b[i]);

  document.addEventListener("mousemove", (e) => {
    if (drag) return;
    if (e.target.closest?.(".inplace-grip")) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
      return;
    }
    let chain = chainAt(e.target);
    // Over the margin to the left of a block, on the way to its grip.
    if (!chain.length || !chain[0].contains(e.target)) {
      const probe = document.elementFromPoint(e.clientX + 40, e.clientY);
      if (probe) chain = chainAt(probe);
    }
    if (sameChain(chain, grips)) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    } else if (!hoverTimer) {
      hoverTimer = setTimeout(() => showGrips(chain), grips.length ? 300 : 0);
    }
  }, { passive: true });
  addEventListener("scroll", () => drag || showGrips([]), { passive: true, capture: true });

  function dropAt(x, y) {
    let best = null;
    let bestDist = Infinity;
    for (const s of drag.siblings) {
      const r = s.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      if (dx * dx + dy * dy < bestDist) {
        bestDist = dx * dx + dy * dy;
        best = { target: s, r };
      }
    }
    const { target, r } = best;
    const before = drag.vertical ? y < r.top + r.height / 2 : x < r.left + r.width / 2;
    const position = before ? "before" : "after";
    const unchanged = before ? target.previousElementSibling === drag.el : target.nextElementSibling === drag.el;
    return { target, position, r, unchanged };
  }

  function showMarker(drop) {
    let marker = document.getElementById("inplace-marker");
    if (!marker) {
      marker = document.createElement("div");
      marker.id = "inplace-marker";
      ui.append(marker);
    }
    marker.style.display = drop.unchanged ? "none" : "";
    const { r } = drop;
    const edge = drop.position === "before";
    Object.assign(marker.style, drag.vertical
      ? { left: `${r.left}px`, top: `${(edge ? r.top : r.bottom) - 2}px`, width: `${r.width}px`, height: "4px" }
      : { left: `${(edge ? r.left : r.right) - 2}px`, top: `${r.top}px`, width: "4px", height: `${r.height}px` });
  }

  ui.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest(".inplace-grip");
    if (!grip || e.button !== 0) return;
    e.preventDefault();
    const el = grips[Number(grip.dataset.index)];
    const siblings = siblingsOf(el);
    if (!siblings.length) return;
    if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
    const items = [el, ...siblings].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const [ra, rb] = items.slice(0, 2).map((n) => n.getBoundingClientRect());
    drag = { el, siblings, drop: null, vertical: rb.top >= ra.bottom - 2 || rb.bottom <= ra.top + 2 };
    toolbar.style.display = "none";
    for (const g of ui.querySelectorAll(".inplace-grip")) g.style.visibility = g === grip ? "" : "hidden";
    el.classList.add("inplace-dragging");
    document.documentElement.classList.add("inplace-is-dragging");
    outline(el);
  });

  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (e.clientY < 40) scrollBy(0, -14);
    else if (e.clientY > innerHeight - 40) scrollBy(0, 14);
    drag.drop = dropAt(e.clientX, e.clientY);
    showMarker(drag.drop);
    outline(drag.el);
  });

  function endDrag() {
    const state = drag;
    drag = null;
    state.el.classList.remove("inplace-dragging");
    document.documentElement.classList.remove("inplace-is-dragging");
    showGrips([]);
    return state;
  }

  document.addEventListener("pointerup", async () => {
    if (!drag) return;
    const { el, drop } = endDrag();
    if (!drop || drop.unchanged) return;
    drop.target[drop.position](el);
    status("Saving…", "info", true);
    const res = await post("move", { id: el.dataset.id, target: drop.target.dataset.id, position: drop.position });
    if (res.ok) {
      version = res.body.version;
      return status("Moved");
    }
    status("Couldn't move this here, probably because the file changed in the meantime. The page will reload.", "error", true);
    setTimeout(reload, 1800);
  });
  document.addEventListener("keydown", (e) => {
    if (drag && e.key === "Escape") endDrag();
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
