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
    [data-id].inplace-changed{background-color:#b9a3ff3d!important}
    [data-id].inplace-changed-fade{animation:inplace-shimmer 1.3s ease-out,inplace-glow 2.6s ease-out,inplace-fade 2.4s ease-in 1.4s both}
    @keyframes inplace-fade{from{background-color:#b9a3ff3d}}
    @keyframes inplace-shimmer{from,to{background-image:linear-gradient(105deg,transparent 38%,#fff3c8d0 50%,transparent 62%);
      background-size:300% 100%;background-repeat:no-repeat}from{background-position:100% 0}to{background-position:0 0}}
    @keyframes inplace-glow{from,to{box-shadow:0 0 0 1px #9b7bff00,0 0 0 #9b7bff00}25%{box-shadow:0 0 0 1px #9b7bff8c,0 0 22px #9b7bff59}}
    .inplace-sparkle{position:fixed;z-index:2147483646;pointer-events:none;line-height:1;font-family:system-ui,sans-serif;
      animation:inplace-sparkle .9s ease-out both}
    @keyframes inplace-sparkle{from{opacity:0;transform:translateY(4px) scale(.2) rotate(0)}30%{opacity:1;transform:translateY(-4px) scale(1.15) rotate(40deg)}
      to{opacity:0;transform:translateY(-16px) scale(.4) rotate(110deg)}}
    @media (prefers-reduced-motion:reduce){[data-id].inplace-changed-fade{animation:inplace-fade 3.8s steps(1,end) both}.inplace-sparkle{display:none}}
    #inplace-status{position:fixed;right:14px;bottom:14px;z-index:2147483647;font:12px/1.3 -apple-system,system-ui,sans-serif;
      background:#1f2a24;color:#fff;padding:7px 11px;border-radius:7px;box-shadow:0 3px 12px #0003;max-width:340px;opacity:.88}
    #inplace-status[data-kind=error]{background:#9c3b1c}
    #inplace-status button{all:unset;margin-left:10px;font-weight:600;text-decoration:underline;cursor:pointer}
    .inplace-grip{position:fixed;z-index:2147483646;width:18px;height:22px;padding:0;margin:0;border:0;border-radius:4px;
      background:#fff;color:#7a8580;box-shadow:0 1px 4px #0002;font:14px/22px system-ui,sans-serif;letter-spacing:-3px;
      text-align:center;cursor:grab;user-select:none;touch-action:none}
    .inplace-grip:hover{color:#1f2a24;background:#eef2fb}
    .inplace-add{letter-spacing:0;font-size:17px;cursor:pointer}
    [data-id][contenteditable]:empty{min-height:1.2em}
    [data-id][contenteditable]:empty:focus::before{content:"Type here";color:#9aa39e;pointer-events:none}
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
    #inplace-stash-badge{all:unset;position:fixed;left:14px;bottom:14px;z-index:2147483647;display:none;padding:7px 12px;
      border-radius:7px;background:#9c3b1c;color:#fff;font:12px/1.3 -apple-system,system-ui,sans-serif;cursor:pointer;
      box-shadow:0 3px 12px #0003}
    #inplace-stash-badge:hover{background:#b4461f}
    #inplace-stash{position:fixed;inset:0;z-index:2147483647;display:none;align-items:flex-start;justify-content:center;
      padding:48px 16px;background:#1f2a2466;overflow:auto;font:14px/1.45 -apple-system,system-ui,sans-serif;color:#1f2a24}
    #inplace-stash.open{display:flex}
    #inplace-stash .panel{box-sizing:border-box;width:min(760px,100%);background:#fff;border-radius:10px;padding:20px 22px;
      box-shadow:0 12px 40px #0004}
    #inplace-stash h2{all:unset;display:block;font-size:17px;font-weight:600;margin:0 0 4px}
    #inplace-stash .intro{margin:0 0 14px;color:#5b6660}
    #inplace-stash .entry{border-top:1px solid #e4e8e5;padding:14px 0}
    #inplace-stash .cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media (max-width:560px){#inplace-stash .cols{grid-template-columns:1fr}}
    #inplace-stash .col h3{all:unset;display:block;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;
      color:#7a8580;margin-bottom:4px}
    #inplace-stash .col div{white-space:pre-wrap;background:#f4f6f5;border-radius:6px;padding:8px 10px;max-height:220px;overflow:auto}
    #inplace-stash .mine div{background:#fbefe9}
    #inplace-stash .note{margin:10px 0 0;color:#9c3b1c}
    #inplace-stash .actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
    #inplace-stash button{all:unset;box-sizing:border-box;padding:6px 11px;border-radius:6px;background:#eef1ef;cursor:pointer;
      font:13px/1.2 -apple-system,system-ui,sans-serif;color:#1f2a24}
    #inplace-stash button:hover{background:#e0e5e2}
    #inplace-stash button.primary{background:#1f2a24;color:#fff}
    #inplace-stash button.primary:hover{background:#34433a}
    #inplace-stash .close{float:right}
    @media print{#inplace-status,#inplace-ui,#inplace-toolbar,#inplace-stash,#inplace-stash-badge{display:none!important}[data-id][contenteditable]{box-shadow:none!important}.inplace-sparkle{display:none!important}
      [data-id].inplace-changed,[data-id].inplace-changed-fade{background-color:transparent!important;animation:none!important}}`;
  document.head.append(style);

  const pill = document.createElement("div");
  pill.id = "inplace-status";
  pill.dataset.inplaceUi = "";
  document.body.append(pill);
  let pillTimer;
  // `sticky` keeps the message up; a number keeps it up for that many ms.
  function status(text, kind = "info", sticky = false) {
    pill.textContent = text;
    pill.dataset.kind = kind;
    delete pill.dataset.owner;
    pill.style.display = "";
    clearTimeout(pillTimer);
    if (sticky !== true) pillTimer = setTimeout(() => (pill.style.display = "none"), sticky || 2500);
  }
  pill.style.display = "none";

  // --- per-block state: the HTML last known to match the file ---
  const saved = new Map(); // id -> innerHTML as last saved / loaded
  const timers = new Map();

  // Containers (tables, rows, figures) also carry a data-id so comments on
  // them can be traced, but only text blocks are editable.
  let editable = new Set((script.dataset.editable || "").split(" "));
  function makeEditable(root) {
    for (const el of [root, ...root.querySelectorAll("[data-id]")]) {
      if (!editable.has(el.dataset?.id) || el.closest("svg, nav, [data-locked], [contenteditable=false]")) continue;
      el.contentEditable = "true";
      el.spellcheck = true;
      saved.set(el.dataset.id, el.innerHTML);
    }
  }
  makeEditable(document.body);

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

  // Chrome types a space next to a formatting tag as &nbsp; and never turns it
  // back. Make those ordinary spaces again, but only inside the part of the
  // block that just changed, so deliberate non-breaking spaces stay.
  function tidySpaces(before, after) {
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

  async function save(el) {
    const id = el.dataset.id;
    clearTimeout(timers.get(id));
    timers.delete(id);
    clean(el);
    const html = tidySpaces(saved.get(id), el.innerHTML);
    if (html === saved.get(id)) return true;
    status("Saving…", "info", true);
    {
      const { ok, status: code, body } = await post("save", { id, old: saved.get(id), new: html });
      if (code === 0) {
        status("Couldn't reach the editor server. Your edits are still on the page.", "error", true);
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
          status("Saved. Your agent changed this paragraph too, so both changes were combined.");
          setTimeout(reload, 600);
        } else status("Saved");
        return true;
      }
      if (res.status === 409) {
        // The file's version of this block changed in the same words. The
        // server kept the user's version in its stash; show the file's.
        el.classList.add("inplace-conflict");
        rememberConflict(id);
        showStashCount(body.stash);
        status("Your agent changed the same words while you were typing. Your version is kept under \u201cSet aside\u201d at the bottom left.", "error", true);
        setTimeout(reload, 2200);
        return false;
      }
      status(`Couldn't save: ${body.error || res.status}`, "error", true);
    }
    return false;
  }

  // While a request is out, a version announced by the server may be our own
  // change; wait for the reply before deciding whether to reload.
  let busy = 0;
  let announced = null; // a version the server announced while a request was out

  async function post(action, payload) {
    busy++;
    try {
      const res = await fetch(`/__inplace/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
      e.preventDefault();
      if (SPLITTABLE.has(el.tagName)) splitBlock(el);
      else el.blur(); // a table cell or caption: Enter just leaves it
    }
    if (e.key === "Backspace" && isBlankEl(el)) {
      const target = /^T[DH]$/.test(el.tagName) ? el.closest("tr") : el;
      if (target?.dataset.id && [...target.querySelectorAll("[contenteditable=true]")].concat(target).every(isBlankEl)) {
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
  let movable = new Set((script.dataset.movable || "").split(" ").filter(Boolean));
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
      if ((isMovable(el) && siblingsOf(el).length) || canAdd(el)) chain.push(el);
    }
    return chain.slice(0, 3);
  }

  const canAdd = (el) => !!el.dataset?.id && INSERTABLE.has(el.tagName) && !el.closest("[data-locked]") &&
    (editable.has(el.dataset.id) || el.tagName === "TR" || el.tagName === "LI");
  const ADD_LABELS = { LI: "Add an item below", TR: "Add a row below", DT: "Add a term below", DD: "Add a description below" };

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
    let plusShown = false;
    chain.forEach((el, depth) => {
      const r = el.getBoundingClientRect();
      const top = Math.max(2, r.top + Math.min(2, r.height / 2 - 11));
      // List items keep their bullet or number clear of the controls.
      const gutter = (el.tagName === "LI" ? 40 : 24) + depth * 44;
      if (canAdd(el) && !plusShown) {
        plusShown = true; // only for the innermost element, to keep the margin readable
        const plus = document.createElement("button");
        plus.type = "button";
        plus.className = "inplace-grip inplace-add";
        plus.title = ADD_LABELS[el.tagName] || "Add a paragraph below";
        plus.setAttribute("aria-label", plus.title);
        plus.textContent = "+";
        plus.style.left = `${Math.max(2, r.left - gutter - 22)}px`;
        plus.style.top = `${top}px`;
        plus.addEventListener("mouseenter", () => outline(el));
        plus.addEventListener("mouseleave", () => outline(null));
        plus.addEventListener("click", () => {
          // Keys typed before the new element arrives shouldn't land in the old one.
          document.activeElement?.blur();
          showGrips([]);
          insertNear(el, { tag: isHeading(el) ? "p" : el.tagName.toLowerCase() });
        });
        ui.append(plus);
      }
      if (!(isMovable(el) && siblingsOf(el).length)) return;
      const grip = document.createElement("button");
      grip.type = "button";
      grip.className = "inplace-grip";
      grip.dataset.index = depth;
      grip.title = `Drag to move this ${nameOf(el)}`;
      grip.setAttribute("aria-label", grip.title);
      grip.textContent = "⋮⋮";
      grip.style.left = `${Math.max(2, r.left - gutter)}px`;
      grip.style.top = `${top}px`;
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
    const grip = e.target.closest(".inplace-grip:not(.inplace-add)");
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

  // --- adding and removing paragraphs, list items and rows ---
  // A new element copies the start tags of its siblings (the server picks the
  // most common pattern), so it looks like its neighbours and never brings
  // markup of its own.
  const SPLITTABLE = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "DT", "DD"]);
  const INSERTABLE = new Set([...SPLITTABLE, "TR"]);
  const isHeading = (el) => /^H\d$/.test(el.tagName);
  const isBlankEl = (el) => !el.textContent.trim() && !el.querySelector("img, svg, video, iframe, canvas");
  const isBlankRange = (r) => !r.toString().trim() && !r.cloneContents().querySelector("img, svg, video, iframe, canvas");

  function caretTo(el, where) {
    if (!el) return;
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(where === "start");
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    el.scrollIntoView({ block: "nearest" });
  }

  function applyLists(body) {
    if (body.editable) editable = new Set(body.editable);
    if (body.movable) movable = new Set(body.movable);
  }

  async function insertNear(el, { position = "after", tag, content = "", split = null }) {
    const id = el.dataset.id;
    const payload = { id, position, tag, content };
    if (split !== null) Object.assign(payload, { old: saved.get(id), new: split });
    const res = await post("insert", payload);
    if (!res.ok) {
      status("Couldn't add this here, probably because the file changed in the meantime. The page will reload.", "error", true);
      return setTimeout(reload, 1800);
    }
    version = res.body.version;
    if (split !== null) saved.set(id, split);
    applyLists(res.body);
    const range = document.createRange();
    range.selectNodeContents(el.parentElement);
    const added = range.createContextualFragment(res.body.html).firstElementChild;
    el[position](added);
    makeEditable(added);
    caretTo(editable.has(added.dataset.id) ? added : added.querySelector("[contenteditable=true]"), "start");
    status("Added");
  }

  // Enter in a paragraph, heading or list item: the text after the caret moves
  // to a new element of the same kind. At the end of a heading, the new
  // element is a paragraph.
  function splitBlock(el) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const at = sel.getRangeAt(0);
    if (!at.collapsed) at.deleteContents();
    clearTimeout(timers.get(el.dataset.id));
    timers.delete(el.dataset.id);
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
    const lead = box.firstChild, end = el.lastChild;
    if (lead?.nodeType === 3) lead.data = lead.data.replace(/^[ \t\n]+/, "");
    if (end?.nodeType === 3) end.data = end.data.replace(/[ \t\n]+$/, "");
    clean(el);
    insertNear(el, {
      tag: isHeading(el) && blankTail ? "p" : own,
      content: blankTail ? "" : box.innerHTML,
      split: el.innerHTML,
    });
  }

  function changed(el) {
    clean(el);
    return el.innerHTML === saved.get(el.dataset.id) ? null : el.innerHTML;
  }

  // Backspace in a paragraph, item or row with nothing left in it removes it.
  async function removeEmpty(el) {
    const blocks = [...document.querySelectorAll("[contenteditable=true]")];
    const previous = blocks.filter((b) => !el.contains(b) && b.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).pop();
    // The server only removes what's empty in the file, so text deleted a
    // moment ago has to be saved first.
    for (const b of [el, ...el.querySelectorAll("[data-id]")]) {
      if (timers.has(b.dataset.id) && !(await save(b))) return;
    }
    const res = await post("remove", { id: el.dataset.id });
    if (!res.ok) {
      status("Couldn't remove this, probably because the file changed in the meantime. The page will reload.", "error", true);
      return setTimeout(reload, 1800);
    }
    version = res.body.version;
    applyLists(res.body);
    el.remove();
    caretTo(previous, "end");
  }

  // --- live reload when the file changes on disk (agent edits) ---
  function rememberConflict(id) {
    try { sessionStorage.setItem(`${STATE_KEY}:conflict`, JSON.stringify({ id })); } catch {}
  }

  // A short hash of what a block holds, as the file has it. Blocks nested
  // inside count only by their id, so a container changes only when its own
  // content does, such as a row being added or removed.
  const tpl = document.createElement("template");
  function fingerprint(el) {
    tpl.innerHTML = saved.get(el.dataset.id) ?? el.innerHTML;
    for (const inner of tpl.content.querySelectorAll("[data-id]")) inner.replaceWith(`\u0001${inner.dataset.id}\u0001`);
    const text = tpl.innerHTML;
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }

  // `skip` lists blocks the user changed themselves, so they aren't shown as
  // the agent's changes after the reload.
  async function reload(skip = []) {
    for (const id of pending()) {
      const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (el && !(await save(el))) return; // a conflict reloads on its own
    }
    const active = document.activeElement?.closest?.("[data-id]");
    const blocks = [...document.querySelectorAll("[data-id]")].map((el) =>
      [el.dataset.id, fingerprint(el), el.parentElement?.closest("[data-id]")?.dataset.id]);
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({ x: scrollX, y: scrollY, focus: active?.dataset.id, blocks, skip }));
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
      status("The highlighted paragraph shows your agent\u2019s version. Yours is under \u201cSet aside\u201d at the bottom left.", "error", true);
    }
    if (state?.blocks) showChanges(state.blocks, new Set([...(state.skip || []), ...(conflict ? [conflict.id] : [])]), !!conflict);
  }
  restore();

  // --- what the agent changed since the page last loaded ---
  // Changed and new blocks are tinted, and the tint fades once the block has
  // been on screen for a moment. `quiet` leaves the status message to a conflict.
  function showChanges(before, skip, quiet) {
    const old = new Map(before.map(([id, hash, parent]) => [id, { hash, parent }]));
    const now = new Map([...document.querySelectorAll("[data-id]")].map((el) => [el.dataset.id, el]));
    const added = [], changed = [];
    for (const [id, el] of now) {
      if (skip.has(id)) continue;
      if (!old.has(id)) added.push(el);
      else if (old.get(id).hash !== fingerprint(el)) changed.push(el);
    }
    // A new table counts as one change, not one per cell; a changed container
    // is shown only when no change inside it explains it.
    const newTops = added.filter((el) => !added.some((o) => o !== el && o.contains(el)));
    const marks = [...newTops, ...changed.filter((el) =>
      !changed.some((o) => o !== el && el.contains(o)) && !newTops.some((o) => el.contains(o)))];
    const removed = [...old].filter(([id, { parent }]) => !now.has(id) && !skip.has(id) && (!parent || now.has(parent))).length;
    if (!marks.length && !removed) return;
    marks.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

    const unseen = new Set(marks);
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > innerHeight * 0.1 && r.top < innerHeight * 0.9;
    };
    const total = marks.length + removed;
    const summary = marks.length
      ? total === 1 ? "\u2726 Your agent made a change." : `\u2726 Your agent made ${total} changes.`
      : removed === 1 ? "\u2726 Your agent removed a paragraph." : `\u2726 Your agent removed ${removed} paragraphs.`;
    function render() {
      if (quiet) return;
      if (!unseen.size) {
        status(summary, "info", 4000);
        pill.dataset.owner = "changes";
        return;
      }
      status(`${summary} ${unseen.size === 1 ? "One is" : `${unseen.size} are`} out of view.`, "info", true);
      pill.dataset.owner = "changes";
      pill.append(make("button", { type: "button", textContent: "Show", onclick: () => {
        const next = [...unseen][0];
        next?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      } }));
    }
    function seen(el) {
      if (!unseen.delete(el)) return;
      observer.unobserve(el);
      reveal(el);
      if (pill.dataset.owner === "changes") render();
    }
    // A shimmer sweeps across the block and a few sparkles rise from its edges.
    function reveal(el) {
      el.classList.replace("inplace-changed", "inplace-changed-fade");
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const r = el.getBoundingClientRect();
      for (let i = 0; i < 6; i++) {
        const top = Math.random() < 0.5;
        const spark = make("span", { className: "inplace-sparkle", textContent: i % 3 ? "\u2726" : "\u2727" });
        spark.dataset.inplaceUi = "";
        spark.style.left = `${r.left + Math.random() * r.width - 6}px`;
        spark.style.top = `${(top ? r.top - 10 : r.bottom - 4) + Math.random() * 8}px`;
        spark.style.fontSize = `${9 + Math.random() * 7}px`;
        spark.style.color = i % 2 ? "#e2b23c" : "#9b7bff";
        spark.style.animationDelay = `${150 + i * 90}ms`;
        spark.addEventListener("animationend", () => spark.remove());
        document.body.append(spark);
      }
    }
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) seen(e.target);
    }, { rootMargin: "-10% 0px -10% 0px" });
    for (const el of marks) {
      el.classList.add("inplace-changed");
      el.addEventListener("animationend", function done(e) {
        if (e.target !== el || e.animationName !== "inplace-fade") return;
        el.classList.remove("inplace-changed-fade");
        el.removeEventListener("animationend", done);
      });
      if (inView(el)) {
        unseen.delete(el);
        reveal(el);
      } else observer.observe(el);
    }
    render();
  }

  // --- edits set aside: the user's versions the server couldn't save or merge ---
  const badge = document.createElement("button");
  badge.id = "inplace-stash-badge";
  badge.dataset.inplaceUi = "";
  badge.type = "button";
  const overlay = document.createElement("div");
  overlay.id = "inplace-stash";
  overlay.dataset.inplaceUi = "";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Set-aside edits");
  document.body.append(badge, overlay);

  function showStashCount(count) {
    if (typeof count !== "number") return;
    badge.textContent = count === 1 ? "1 edit set aside" : `${count} edits set aside`;
    badge.style.display = count ? "block" : "none";
    if (!count) overlay.classList.remove("open");
    else if (overlay.classList.contains("open")) renderStash();
  }

  // Stashed HTML is shown as text only, never inserted into the page.
  const textOf = (html) =>
    new DOMParser().parseFromString(`<body>${html.replace(/<br\s*\/?>/gi, "\n")}`, "text/html").body.textContent.trim();

  function make(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  }

  async function renderStash() {
    let entries;
    try {
      entries = (await (await fetch("/__inplace/stash")).json()).entries;
    } catch {
      return status("Couldn't reach the editor server.", "error", true);
    }
    const panel = make("div", { className: "panel" },
      make("button", { className: "close", type: "button", textContent: "Close", onclick: closeStash }),
      make("h2", { textContent: "Edits set aside" }),
      make("p", { className: "intro", textContent: "You and your agent changed the same words at the same time. The document kept your agent\u2019s version, and yours is saved here so you can choose what to keep." }));
    if (!entries.length) panel.append(make("p", { textContent: "Nothing is set aside." }));
    for (const entry of entries) {
      const actions = make("div", { className: "actions" });
      const act = (label, action, primary) => make("button", {
        type: "button", textContent: label, className: primary ? "primary" : "",
        onclick: () => resolveStash(entry, action),
      });
      if (entry.current !== null) {
        actions.append(act("Use my version", "mine", true), act("Add mine below it", "below"));
        actions.append(make("button", { type: "button", textContent: "Show in document", onclick: () => {
          closeStash();
          const target = document.querySelector(`[data-id="${CSS.escape(entry.id)}"]`);
          target?.scrollIntoView({ block: "center" });
          target?.classList.add("inplace-conflict");
        } }));
      }
      actions.append(
        make("button", { type: "button", textContent: "Copy my version", onclick: async (e) => {
          try { await navigator.clipboard.writeText(textOf(entry.mine)); e.target.textContent = "Copied"; }
          catch { e.target.textContent = "Couldn\u2019t copy"; }
        } }),
        act("Dismiss", "discard"),
      );
      const note = entry.current === null
        ? "This paragraph is no longer in the document."
        : entry.changed ? "This paragraph has changed again since. Your agent may already have combined both versions." : "";
      panel.append(make("div", { className: "entry" },
        make("div", { className: "cols" },
          make("div", { className: "col mine" }, make("h3", { textContent: "Your version" }), make("div", { textContent: textOf(entry.mine) })),
          make("div", { className: "col" }, make("h3", { textContent: "In the document now" }),
            make("div", { textContent: entry.current === null ? "\u2014" : textOf(entry.current) }))),
        ...(note ? [make("p", { className: "note", textContent: note })] : []),
        actions));
    }
    overlay.replaceChildren(panel);
  }

  async function resolveStash(entry, action) {
    const res = await post("stash/resolve", { n: entry.n, action });
    if (!res.ok) {
      status("Couldn't do that, probably because the paragraph changed again. The list is updated.", "error", true);
      return renderStash();
    }
    version = res.body.version;
    if (action !== "discard") {
      closeStash();
      reload([entry.id]);
    } else renderStash();
  }

  async function openStash() {
    await renderStash();
    overlay.classList.add("open");
  }
  function closeStash() {
    overlay.classList.remove("open");
  }
  badge.addEventListener("click", openStash);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeStash(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.classList.contains("open")) closeStash(); });

  const events = new EventSource("/__inplace/events");
  events.addEventListener("stash", (e) => showStashCount(Number(e.data)));
  events.addEventListener("version", (e) => {
    if (busy) announced = e.data;
    else if (e.data !== version) reload();
  });
  events.onerror = () => status("Lost connection to the editor server. Reconnecting…", "error", true);
  events.onopen = () => { if (pill.dataset.kind === "error" && pill.textContent.startsWith("Lost")) status("Reconnected"); };
})();
