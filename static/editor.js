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
    [data-id].inplace-changed{background-color:#c4b2ff38!important}
    [data-id].inplace-changed-fade{animation:inplace-ink .9s cubic-bezier(.2,.7,.2,1),inplace-shimmer 1.6s cubic-bezier(.4,0,.2,1) .1s,
      inplace-glow 3s ease-out,inplace-fade 2.6s ease-in 1.8s both}
    @keyframes inplace-ink{from{opacity:.25;filter:blur(3px)}to{opacity:1;filter:blur(0)}}
    @keyframes inplace-fade{from{background-color:#c4b2ff38}}
    @keyframes inplace-shimmer{from,to{background-image:linear-gradient(105deg,transparent 28%,#f6c3e033 40%,#fff6dcd9 50%,#cdbdff66 60%,transparent 72%);
      background-size:320% 100%;background-repeat:no-repeat}from{background-position:100% 0}to{background-position:0 0}}
    @keyframes inplace-glow{from,to{box-shadow:0 0 0 1px #a58bff00,0 0 0 #f29fc500,0 0 0 #9b7bff00}
      22%{box-shadow:0 0 0 1px #b39cffa6,-10px 2px 26px #f29fc54d,10px -2px 26px #9b7bff59}}
    .inplace-sparkle{position:fixed;z-index:2147483646;pointer-events:none;display:block;
      filter:drop-shadow(0 0 3px currentColor) drop-shadow(0 0 7px currentColor);animation:inplace-sparkle var(--t) cubic-bezier(.2,.6,.3,1) both}
    .inplace-sparkle svg{display:block;width:100%;height:100%}
    .inplace-sparkle.dot{border-radius:50%;background:currentColor}
    @keyframes inplace-sparkle{from{opacity:0;transform:translate(0,0) scale(0) rotate(0)}
      30%{opacity:1;transform:translate(calc(var(--dx)*.35),calc(var(--dy)*.35)) scale(1) rotate(calc(var(--rot)*.4))}
      to{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.2) rotate(var(--rot))}}
    #inplace-status[data-owner=changes]{opacity:.96;border:1px solid transparent;padding:6px 11px 6px 9px;
      background:linear-gradient(#1f2a24,#1f2a24) padding-box,linear-gradient(100deg,#9b7bff,#f29fc5,#e9c46a,#9b7bff) 0 0/300% 100% border-box;
      animation:inplace-border 5s linear infinite}
    @keyframes inplace-border{to{background-position:0 0,300% 0}}
    #inplace-status .star{display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-1.5px;color:#f1d27a;
      filter:drop-shadow(0 0 3px #f1d27a99);animation:inplace-twinkle 1.4s ease-in-out 2}
    #inplace-status .star svg{display:block;width:100%;height:100%}
    @keyframes inplace-twinkle{50%{transform:scale(.6) rotate(45deg);opacity:.6}}
    @media (prefers-reduced-motion:reduce){[data-id].inplace-changed-fade{animation:inplace-fade 4.4s steps(1,end) both}.inplace-sparkle{display:none}
      #inplace-status[data-owner=changes],#inplace-status .star{animation:none}}
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
    #inplace-corner{all:unset;box-sizing:border-box;position:fixed;left:14px;bottom:14px;z-index:2147483647;display:none;
      align-items:center;justify-content:center;width:36px;height:36px;border-radius:18px;background:#1f2a24;color:#e8ece9;
      font:12px/1.3 -apple-system,system-ui,sans-serif;cursor:pointer;box-shadow:0 3px 12px #0003}
    #inplace-corner.shown{display:flex}
    #inplace-corner:hover{background:#34433a}
    #inplace-corner:focus-visible{outline:2px solid #4a7bd4;outline-offset:2px}
    #inplace-corner svg{width:18px;height:18px}
    #inplace-corner .dot{position:absolute;top:0;right:0;width:9px;height:9px;border-radius:50%;background:#b39cff;
      box-shadow:0 0 0 2px #fff,0 0 8px #9b7bff}
    #inplace-corner.stash{width:auto;height:auto;padding:7px 12px;border-radius:7px;background:#9c3b1c;color:#fff}
    #inplace-corner.stash:hover{background:#b4461f}
    #inplace-changes{position:fixed;left:14px;bottom:60px;z-index:2147483647;display:none;flex-direction:column;box-sizing:border-box;
      width:min(380px,calc(100vw - 28px));max-height:min(70vh,560px);overflow:hidden;border-radius:12px;background:#fff;color:#1f2a24;
      box-shadow:0 12px 40px #0003,0 0 0 1px #0000000f;font:13px/1.45 -apple-system,system-ui,sans-serif;text-align:left}
    #inplace-changes.open{display:flex}
    #inplace-changes header{display:flex;align-items:center;justify-content:space-between;padding:12px 10px 6px 16px}
    #inplace-changes h2{all:unset;font-size:14px;font-weight:600}
    #inplace-changes .x{all:unset;cursor:pointer;color:#7a8580;font-size:20px;line-height:1;padding:2px 7px 4px;border-radius:6px}
    #inplace-changes .x:hover{background:#eef1ef;color:#1f2a24}
    #inplace-changes .list{overflow:auto;padding:0 8px 8px}
    #inplace-changes .agent-status{margin:0 8px 8px;color:#56615b}
    #inplace-changes .aside{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 0 8px;padding:9px 11px;
      border-radius:8px;background:#fbefe9;color:#7a2e14}
    #inplace-changes .aside button{all:unset;cursor:pointer;font-weight:600;text-decoration:underline;white-space:nowrap}
    #inplace-changes .entry{padding:9px 0 5px;border-top:1px solid #eef1ef}
    #inplace-changes .entry:first-child{border-top:0}
    #inplace-changes .who{display:flex;align-items:center;gap:6px;padding:0 8px 2px;font-size:12px;font-weight:600}
    #inplace-changes .who .when{margin-left:auto;font-weight:400;color:#7a8580}
    #inplace-changes .who .star{display:block;width:12px;height:12px;color:#9b7bff;filter:drop-shadow(0 0 3px #b39cff88)}
    #inplace-changes .who .star svg{display:block;width:100%;height:100%}
    #inplace-changes ul{all:unset;display:block;list-style:none}
    #inplace-changes li{display:block}
    #inplace-changes .change{all:unset;box-sizing:border-box;display:block;width:100%;padding:5px 8px;border-radius:7px}
    #inplace-changes button.change{cursor:pointer}
    #inplace-changes button.change:hover{background:#f4f1ff}
    #inplace-changes button.change:focus-visible{outline:2px solid #4a7bd4}
    #inplace-changes .kind{display:block;margin-bottom:1px;font-size:11px;color:#7a8580}
    #inplace-changes .text{display:block;overflow-wrap:anywhere}
    #inplace-changes del{padding:0 2px;border-radius:3px;background:#fbe9e3;color:#a1452a;text-decoration:line-through;
      text-decoration-color:#a1452a88}
    #inplace-changes ins{padding:0 2px;border-radius:3px;background:#ece5ff;color:#3d2a85;text-decoration:none}
    #inplace-changes .entry[data-by=you] .who,#inplace-changes .entry[data-by=you] .text{color:#5b6660}
    #inplace-changes .entry[data-by=you] ins{background:#e9eeeb;color:#1f2a24}
    #inplace-changes .empty{margin:0;padding:4px 8px 10px;color:#7a8580}
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
    @media print{#inplace-status,#inplace-ui,#inplace-toolbar,#inplace-stash,#inplace-corner,#inplace-changes{display:none!important}[data-id][contenteditable]{box-shadow:none!important}.inplace-sparkle{display:none!important}
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

  // Sparkles shown with the agent's changes.
  const STAR = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 0C12.8 7.4 16.6 11.2 24 12 16.6 12.8 12.8 16.6 12 24 11.2 16.6 7.4 12.8 0 12 7.4 11.2 11.2 7.4 12 0Z"/></svg>';
  const SPARKLE_COLORS = ["#f1d27a", "#b39cff", "#f4a9cf", "#fff3d1"];

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

  // --- word-level diff ---
  // Splits text into words, runs of spaces and punctuation marks, so "laundry,"
  // and "laundry daily," share the word and the comma.
  const tokenize = (text) => text.split(/(\s+|[.,;:!?()\[\]"\u201c\u201d])/).filter(Boolean);
  const isSpace = (t) => /^\s+$/.test(t);
  // Any two runs of spaces or line breaks count as the same.
  const same = (x, y) => x === y || (isSpace(x) && isSpace(y));

  // Before \u2192 after as a list of runs: { same: [tokens] } for unchanged text
  // and { gone: [tokens], added: [tokens] } for each changed stretch.
  function diffWords(before, after) {
    const a = tokenize(before), b = tokenize(after);
    let p = 0;
    while (p < a.length && p < b.length && same(a[p], b[p])) p++;
    let q = 0;
    while (q < a.length - p && q < b.length - p && same(a[a.length - 1 - q], b[b.length - 1 - q])) q++;
    const A = a.slice(p, a.length - q), B = b.slice(p, b.length - q);
    const ops = []; // [kind, token], kind is "=", "-" or "+"
    if (A.length * B.length > 60000) {
      // Too long to compare word by word quickly: show it as one replacement.
      for (const t of A) ops.push(["-", t]);
      for (const t of B) ops.push(["+", t]);
    } else {
      // Longest common subsequence of the tokens in the middle.
      const len = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
      for (let i = A.length - 1; i >= 0; i--)
        for (let j = B.length - 1; j >= 0; j--)
          len[i][j] = same(A[i], B[j]) ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
      let i = 0, j = 0;
      while (i < A.length || j < B.length) {
        if (i < A.length && j < B.length && same(A[i], B[j])) { ops.push(["=", B[j++]]); i++; }
        else if (j < B.length && (i === A.length || len[i][j + 1] >= len[i + 1][j])) ops.push(["+", B[j++]]);
        else ops.push(["-", A[i++]]);
      }
    }
    const runs = [];
    const push = (kind, t) => {
      const last = runs.at(-1);
      if (kind === "=") {
        if (last?.same) last.same.push(t);
        else runs.push({ same: [t] });
      } else {
        const run = last && !last.same ? last : (runs.push({ gone: [], added: [] }), runs.at(-1));
        (kind === "-" ? run.gone : run.added).push(t);
      }
    };
    for (const t of b.slice(0, p)) push("=", t);
    for (const [kind, t] of ops) push(kind, t);
    for (const t of b.slice(b.length - q)) push("=", t);
    // A space, a comma or one short word left between two changes reads
    // better as part of one larger change: "Two beds" \u2192 "Three cots", not
    // "Two" \u2192 "Three" + "beds" \u2192 "cots".
    for (let k = 1; k < runs.length - 1; k++) {
      const run = runs[k];
      if (!run.same || runs[k - 1].same || runs[k + 1].same) continue;
      const words = run.same.filter((t) => !isSpace(t));
      if (words.length > 1 || (words.length === 1 && words[0].length > 3 && /\w/.test(words[0]))) continue;
      const prev = runs[k - 1], next = runs[k + 1];
      prev.gone.push(...run.same, ...next.gone);
      prev.added.push(...run.same, ...next.added);
      runs.splice(k, 2);
      k--;
    }
    return runs;
  }

  // --- changed words inside a paragraph ---
  // Marked with the CSS Custom Highlight API, which colours text ranges without
  // touching the page's HTML, so nothing extra ends up in what gets saved.
  const wordChanges = new WeakMap(); // element -> { before, ranges, name, rule }
  const wordStyle = document.createElement("style");
  wordStyle.dataset.inplaceUi = "";
  document.head.append(wordStyle);
  const WORD_TINT = [179, 156, 255, 0.42];
  addEventListener("beforeprint", () => {
    for (const name of [...(window.CSS?.highlights?.keys() ?? [])]) if (name.startsWith("inplace-words-")) CSS.highlights.delete(name);
  });
  let wordCount = 0;

  // Text ranges in `el` that differ from `before`, or null when the change is
  // better shown on the whole block: nothing added, or most of it rewritten.
  function changedRanges(el, before) {
    const text = el.textContent;
    const spans = [];
    let at = 0, added = 0;
    for (const run of diffWords(before, text)) {
      const piece = (run.same || run.added).join("");
      if (!run.same && piece.trim()) {
        const lead = piece.length - piece.trimStart().length, trail = piece.length - piece.trimEnd().length;
        spans.push([at + lead, at + piece.length - trail]);
        added += piece.trim().length;
      }
      at += piece.length;
    }
    if (!spans.length || added > text.trim().length * 0.6) return null;
    // Turn text offsets into ranges over the element's text nodes.
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(), pos = 0; n; n = walker.nextNode()) {
      nodes.push([n, pos]);
      pos += n.data.length;
    }
    const point = (offset, end) => {
      for (let k = nodes.length - 1; k >= 0; k--) {
        const [n, pos] = nodes[k];
        if (end ? offset > pos : offset >= pos) return [n, Math.min(offset - pos, n.data.length)];
      }
      return null;
    };
    return spans.map(([from, to]) => {
      const range = document.createRange();
      const start = point(from, false), end = point(to, true);
      if (!start || !end) return null;
      range.setStart(...start);
      range.setEnd(...end);
      return range;
    }).filter(Boolean);
  }

  function tintWords(el, before) {
    if (!window.CSS?.highlights || !window.Highlight || !editable.has(el.dataset.id)) return false;
    const ranges = changedRanges(el, before);
    if (!ranges?.length) return false;
    const name = `inplace-words-${++wordCount}`;
    CSS.highlights.set(name, new Highlight(...ranges));
    const sheet = wordStyle.sheet;
    const rule = sheet.cssRules[sheet.insertRule(`::highlight(${name}){background-color:rgba(${WORD_TINT.join(",")})}`, sheet.cssRules.length)];
    wordChanges.set(el, { before, ranges, name, rule });
    el.classList.add("inplace-changed-words");
    return true;
  }

  // Keep the tint a moment, then fade it out, as the block tint does.
  function fadeWords(words) {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hold = reduced ? 4400 : 1800, fade = reduced ? 0 : 2600;
    const start = performance.now() + hold;
    const step = (now) => {
      if (words.done) return;
      const t = Math.min(1, Math.max(0, (now - start) / (fade || 1)));
      const alpha = WORD_TINT[3] * (1 - t * t);
      words.rule.style.backgroundColor = `rgba(${WORD_TINT.slice(0, 3).join(",")},${alpha.toFixed(3)})`;
      if (t < 1) requestAnimationFrame(step);
      else CSS.highlights.delete(words.name);
    };
    requestAnimationFrame(step);
  }

  function clearWords(el, words) {
    words.done = true;
    CSS.highlights.delete(words.name);
    wordChanges.delete(el);
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
    // Changes the user hasn't seen yet stay marked after the next reload.
    const unseen = [...document.querySelectorAll("[data-id].inplace-changed, [data-id].inplace-changed-words")]
      .map((el) => el.dataset.id);
    // The text of each paragraph, so the changed words can be found after the
    // reload. For changes not seen yet, the text from before those changes.
    const texts = {};
    for (const el of document.querySelectorAll("[data-id][contenteditable]"))
      texts[el.dataset.id] = el.classList.contains("inplace-changed-words") ? wordChanges.get(el).before : el.textContent;
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({ x: scrollX, y: scrollY, focus: active?.dataset.id, blocks, skip, unseen,
        texts, changes: changesPanel.classList.contains("open") }));
    } catch {}
    location.reload();
  }

  let reopenChanges = false; // the list of changes was open before the reload
  function restore() {
    let state;
    try { state = JSON.parse(sessionStorage.getItem(STATE_KEY) || "null"); sessionStorage.removeItem(STATE_KEY); } catch {}
    if (state) {
      reopenChanges = !!state.changes;
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
    if (state?.blocks) showChanges(state.blocks, new Set([...(state.skip || []), ...(conflict ? [conflict.id] : [])]), !!conflict, state.unseen || [], state.texts || {});
  }
  restore();

  // --- what the agent changed since the page last loaded ---
  // Changed and new blocks are tinted, and the tint fades once the block has
  // been on screen for a moment. `quiet` leaves the status message to a conflict.
  function showChanges(before, skip, quiet, earlier, texts) {
    const old = new Map(before.map(([id, hash, parent]) => [id, { hash, parent }]));
    const now = new Map([...document.querySelectorAll("[data-id]")].map((el) => [el.dataset.id, el]));
    const added = [], changed = [];
    for (const [id, el] of now) {
      if (skip.has(id)) continue;
      if (!old.has(id)) added.push(el);
      else if (old.get(id).hash !== fingerprint(el) || earlier.includes(id)) changed.push(el);
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
      ? total === 1 ? "Your agent made a change." : `Your agent made ${total} changes.`
      : removed === 1 ? "Your agent removed a paragraph." : `Your agent removed ${removed} paragraphs.`;
    function render() {
      if (quiet) return;
      const star = () => {
        const icon = make("span", { className: "star" });
        icon.innerHTML = STAR;
        pill.prepend(icon);
        pill.dataset.owner = "changes";
      };
      if (!unseen.size) {
        status(summary, "info", 4000);
        return star();
      }
      status(`${summary} ${unseen.size === 1 ? "One is" : `${unseen.size} are`} out of view.`, "info", true);
      star();
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
    // In a background tab nothing counts as seen until the tab is shown.
    const observer = new IntersectionObserver((entries) => {
      if (document.hidden) return;
      for (const e of entries) if (e.isIntersecting) seen(e.target);
    }, { rootMargin: "-10% 0px -10% 0px" });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) for (const el of [...unseen]) if (inView(el)) seen(el);
    });
    for (const el of marks) {
      const id = el.dataset.id;
      if (!(old.has(id) && texts[id] !== undefined && tintWords(el, texts[id]))) el.classList.add("inplace-changed");
      if (inView(el) && !document.hidden) {
        unseen.delete(el);
        reveal(el);
      } else observer.observe(el);
    }
    render();
  }

  // The text settles in from a soft blur while a shimmer sweeps across the
  // block, and sparkles rise from its edges, following the shimmer.
  // When only some words changed, those words fade instead and the sparkles
  // rise from them.
  function reveal(el) {
    const words = wordChanges.get(el);
    if (words) {
      el.classList.remove("inplace-changed-words");
      fadeWords(words);
    } else el.classList.replace("inplace-changed", "inplace-changed-fade");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const boxes = words
      ? words.ranges.flatMap((range) => [...range.getClientRects()]).filter((b) => b.width > 0)
      : [el.getBoundingClientRect()];
    if (!boxes.length) return;
    const width = boxes.reduce((sum, b) => sum + b.width, 0);
    const count = Math.round(Math.min(16, (words ? 4 : 7) + width / 90));
    for (let i = 0; i < count; i++) {
      // Pick a box in proportion to its width, then a point along it.
      let pick = Math.random() * width, r = boxes[0];
      for (const b of boxes) { r = b; if ((pick -= b.width) <= 0) break; }
      const along = Math.random();
      const dot = i % 3 === 2;
      const size = dot ? 2 + Math.random() * 2.5 : 7 + Math.random() * 9;
      const spark = make("span", { className: dot ? "inplace-sparkle dot" : "inplace-sparkle" });
      if (!dot) spark.innerHTML = STAR;
      spark.dataset.inplaceUi = "";
      const edge = Math.random();
      const y = edge < 0.45 ? r.top : edge < 0.9 ? r.bottom : r.top + Math.random() * r.height;
      Object.assign(spark.style, {
        left: `${r.left + along * r.width - size / 2}px`,
        top: `${y - size / 2 + (Math.random() - 0.5) * 10}px`,
        width: `${size}px`, height: `${size}px`,
        color: SPARKLE_COLORS[i % SPARKLE_COLORS.length],
        animationDelay: `${120 + along * 900 + Math.random() * 180}ms`,
      });
      spark.style.setProperty("--t", `${900 + Math.random() * 700}ms`);
      spark.style.setProperty("--dx", `${(Math.random() - 0.5) * 30}px`);
      spark.style.setProperty("--dy", `${-12 - Math.random() * 26}px`);
      spark.style.setProperty("--rot", `${(Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 120)}deg`);
      spark.addEventListener("animationend", () => spark.remove());
      document.body.append(spark);
    }
  }
  // Once the fade has run, the block goes back to how the document styles it.
  document.addEventListener("animationend", (e) => {
    if (e.animationName === "inplace-fade") e.target.classList?.remove("inplace-changed-fade");
  });

  // Show a block's change again, as when it first appeared. With the text from
  // before the change, only the changed words light up.
  function replay(el, before) {
    el.classList.remove("inplace-changed", "inplace-changed-fade", "inplace-changed-words");
    const words = wordChanges.get(el);
    if (words) clearWords(el, words);
    void el.offsetWidth;
    if (before === undefined || !tintWords(el, before)) el.classList.add("inplace-changed");
    reveal(el);
  }

  // --- edits set aside: the user's versions the server couldn't save or merge ---
  // One button in the corner opens the list of changes. While edits are set
  // aside it says so instead, since those need the user's attention.
  const corner = document.createElement("button");
  corner.id = "inplace-corner";
  corner.dataset.inplaceUi = "";
  corner.type = "button";
  const overlay = document.createElement("div");
  overlay.id = "inplace-stash";
  overlay.dataset.inplaceUi = "";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Set-aside edits");
  const changesPanel = document.createElement("div");
  changesPanel.id = "inplace-changes";
  changesPanel.dataset.inplaceUi = "";
  changesPanel.setAttribute("role", "dialog");
  changesPanel.setAttribute("aria-label", "Changes");
  document.body.append(corner, overlay, changesPanel);

  let stashCount = 0;
  function showStashCount(count) {
    if (typeof count !== "number") return;
    stashCount = count;
    updateCorner();
    if (changesPanel.classList.contains("open")) renderChanges();
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
  // --- whether an agent is picking up your edits, as far as the server can tell ---
  // The server sends { state, ago } on the "agent" event; ago is in seconds, as of when it arrived.
  let agentStatus = null;
  let agentStatusAt = 0;
  function agentStatusLine() {
    if (!agentStatus) return null;
    let text;
    if (agentStatus.state === "waiting") text = "Your agent is waiting for your next pause.";
    else if (agentStatus.state === "working") text = "Your agent picked up your last changes.";
    else if (agentStatus.state === "checked") {
      const s = agentStatus.ago + (Date.now() - agentStatusAt) / 1000;
      const when = s < 45 ? "just now" : s < 90 ? "a minute ago" : s < 3600 ? `${Math.round(s / 60)} minutes ago`
        : `at ${new Date(Date.now() - s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      text = `Your agent last checked your changes ${when}.`;
    } else if (agentStatus.state === "none") text = "No agent has checked your changes yet. Ask your agent to pick up your edits.";
    // Agents reading the terminal output or a log file can't be seen, so don't say anything about them.
    else text = "If your agent doesn't react to your edits, ask it to check them.";
    return make("p", { className: "agent-status", textContent: text });
  }
  function showAgentStatus(data) {
    try { agentStatus = JSON.parse(data); } catch { return; }
    agentStatusAt = Date.now();
    if (changesPanel.classList.contains("open")) renderChanges();
  }

  // --- the list of changes ---
  const HISTORY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7.5V12l3 2"/></svg>';
  const SEEN_KEY = `${STATE_KEY}:seen-changes`;
  let history = [];
  let seenChanges = null;
  try { seenChanges = JSON.parse(sessionStorage.getItem(SEEN_KEY) || "null"); } catch {}
  const latestByAgent = () => history.reduce((n, e) => (e.by === "agent" ? Math.max(n, e.n) : n), 0);

  function updateCorner() {
    corner.classList.toggle("stash", stashCount > 0);
    corner.classList.toggle("shown", stashCount > 0 || history.length > 0);
    if (stashCount) {
      corner.removeAttribute("aria-label");
      corner.removeAttribute("title");
      corner.textContent = stashCount === 1 ? "1 edit set aside" : `${stashCount} edits set aside`;
      return;
    }
    corner.setAttribute("aria-label", "Changes");
    corner.title = "Changes";
    corner.innerHTML = history.length ? HISTORY_ICON : "";
    if (latestByAgent() > (seenChanges ?? 0)) corner.append(make("span", { className: "dot" }));
  }

  async function loadHistory() {
    try {
      history = (await (await fetch("/__inplace/history")).json()).entries;
    } catch {
      return;
    }
    // A newly opened page starts with nothing new to point out.
    if (seenChanges === null) markChangesSeen();
    updateCorner();
    if (changesPanel.classList.contains("open")) renderChanges();
  }

  function markChangesSeen() {
    seenChanges = latestByAgent();
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(seenChanges)); } catch {}
  }

  const NOUNS = { P: "paragraph", LI: "list item", TR: "table row", TD: "table cell", TH: "table cell", TABLE: "table",
    UL: "list", OL: "list", DT: "term", DD: "description", FIGURE: "figure", FIGCAPTION: "caption", CAPTION: "caption",
    BLOCKQUOTE: "quote" };
  const noun = (tag) => (/^h\d$/i.test(tag) ? "heading" : NOUNS[tag.toUpperCase()] || "text");
  const capital = (s) => s[0].toUpperCase() + s.slice(1);
  function describe(change) {
    if (change.kind === "added") return `New ${noun(change.tag)}`;
    if (change.kind === "removed") return `Removed ${noun(change.tag)}`;
    if (change.kind === "moved") return `Moved ${noun(change.tag)}`;
    if (change.fromTag && noun(change.fromTag) !== noun(change.tag)) return `${capital(noun(change.fromTag))} \u2192 ${noun(change.tag)}`;
    return `Edited ${noun(change.tag)}`;
  }

  const clipText = (s, max = 220) => (s.length > max ? s.slice(0, max) + "\u2026" : s);
  // The changed words with a few words around them, so a one-word edit in a
  // long paragraph is easy to spot. Long unchanged stretches are shortened.
  function snippet(change) {
    const before = change.before ?? "", after = change.after ?? "";
    if (change.kind === "added") return [make("ins", { textContent: clipText(after) })];
    if (change.kind === "removed") return [make("del", { textContent: clipText(before) })];
    if (change.kind === "moved" || before === after) return [clipText(after)];
    const CONTEXT = 8; // words and the spaces between them
    const runs = diffWords(before, after);
    const out = [];
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
      const lead = (!gone.trim() ? added : !added.trim() ? gone : "").match(/^\s*/)[0];
      const trail = (!gone.trim() ? added : !added.trim() ? gone : "").match(/\s*$/)[0];
      if (lead) out.push(lead);
      if (gone.trim()) out.push(make("del", { textContent: clipText(gone.trim(), 160) }));
      if (gone.trim() && added.trim()) out.push(" ");
      if (added.trim()) out.push(make("ins", { textContent: clipText(added.trim(), 160) }));
      if (trail) out.push(trail);
    });
    return out;
  }

  function ago(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 45) return "just now";
    if (s < 90) return "a minute ago";
    if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function goTo(el, change) {
    if (matchMedia("(max-width: 600px)").matches) closeChanges();
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const r = el.getBoundingClientRect();
    const before = change.kind === "changed" ? change.before : undefined;
    if (r.top >= 0 && r.bottom <= innerHeight) return replay(el, before);
    let done = false;
    const then = () => { if (!done) { done = true; replay(el, before); } };
    addEventListener("scrollend", then, { once: true });
    setTimeout(then, reduced ? 0 : 700);
    el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }

  function renderChanges() {
    const list = make("div", { className: "list" });
    const agentLine = agentStatusLine();
    if (agentLine) list.append(agentLine);
    if (stashCount) {
      list.append(make("div", { className: "aside" },
        make("span", { textContent: stashCount === 1
          ? "You and your agent changed the same words, so your version was set aside."
          : `You and your agent changed the same words in ${stashCount} places, so your versions were set aside.` }),
        make("button", { type: "button", textContent: "Review", onclick: () => { closeChanges(); openStash(); } })));
    }
    if (!history.length) list.append(make("p", { className: "empty", textContent: "Nothing has changed yet." }));
    for (const entry of [...history].reverse()) {
      const who = make("div", { className: "who" });
      if (entry.by === "agent") {
        const icon = make("span", { className: "star" });
        icon.innerHTML = STAR;
        who.append(icon, "Your agent");
      } else who.append("You");
      who.append(make("span", { className: "when", textContent: ago(entry.at) }));
      const items = make("ul");
      for (const change of entry.changes) {
        const el = change.kind !== "removed" && document.querySelector(`[data-id="${CSS.escape(change.id)}"]`);
        const body = [make("span", { className: "kind", textContent: describe(change) }),
          make("span", { className: "text" }, ...snippet(change))];
        items.append(make("li", {}, el
          ? make("button", { type: "button", className: "change", title: "Show in the document", onclick: () => goTo(el, change) }, ...body)
          : make("div", { className: "change" }, ...body)));
      }
      const node = make("div", { className: "entry" }, who, items);
      node.dataset.by = entry.by;
      list.append(node);
    }
    changesPanel.replaceChildren(
      make("header", {}, make("h2", { textContent: "Changes" }),
        make("button", { type: "button", className: "x", textContent: "\u00d7", ariaLabel: "Close", onclick: closeChanges })),
      list);
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
    if (changesPanel.classList.contains("open") && !changesPanel.contains(e.target) && !corner.contains(e.target)) closeChanges();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && changesPanel.classList.contains("open") && !overlay.classList.contains("open")) closeChanges();
  });
  // Times like "2 minutes ago" stay current while the list is open.
  setInterval(() => { if (changesPanel.classList.contains("open")) renderChanges(); }, 30_000);
  if (reopenChanges) openChanges();
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeStash(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.classList.contains("open")) closeStash(); });

  const events = new EventSource("/__inplace/events");
  events.addEventListener("stash", (e) => showStashCount(Number(e.data)));
  events.addEventListener("agent", (e) => showAgentStatus(e.data));
  events.addEventListener("history", (e) => {
    if (Number(e.data) > 0) return loadHistory();
    if (seenChanges === null) markChangesSeen();
  });
  events.addEventListener("version", (e) => {
    if (busy) announced = e.data;
    else if (e.data !== version) reload();
  });
  events.onerror = () => status("Lost connection to the editor server. Reconnecting…", "error", true);
  events.onopen = () => { if (pill.dataset.kind === "error" && pill.textContent.startsWith("Lost")) status("Reconnected"); };
})();
