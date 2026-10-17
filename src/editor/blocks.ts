// --- per-block state: the HTML last known to match the file ---
const saved = new Map<string, string>(); // id -> innerHTML as last saved / loaded
const timers = new Map<string, number>();

// Containers (tables, rows, figures) also carry a data-id so comments on
// them can be traced, but only text blocks are editable.
let editable = new Set<string>((script.dataset.editable || "").split(" "));

// In a document with scripts, what each block holds in the file, as a hash.
// A block a script has changed shows something the file doesn't have, so
// typing in it would save the script's output into the file: it stays as it
// is. The hash must match contentHash in src/htmldoc.ts.
const hashes: Record<string, string> | null = script.dataset.hashes ? JSON.parse(script.dataset.hashes) : null;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " " };
function contentHash(html: string) {
  const text = html.replace(/&(amp|lt|gt|quot|nbsp);/g, (_, e: string) => ENTITIES[e]).replace(/\s+/g, " ").trim();
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
const scripted = new Set<string>(); // ids of blocks a script has changed
const changedByScript = (el: HTMLElement) =>
  hashes?.[el.dataset.id!] !== undefined && contentHash(el.innerHTML) !== hashes[el.dataset.id!];
function lockScripted(el: HTMLElement) {
  const id = el.dataset.id!;
  scripted.add(id);
  el.removeAttribute("contenteditable");
  el.title = "This text is filled in by a script on the page. To change it, ask your agent.";
  clearTimeout(timers.get(id));
  timers.delete(id);
}

function makeEditable(root: HTMLElement) {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>("[data-id]")]) {
    if (!editable.has(el.dataset?.id!) || el.closest("svg, nav, [data-locked], [contenteditable=false]")) continue;
    if (scripted.has(el.dataset.id!) || changedByScript(el)) {
      lockScripted(el);
      continue;
    }
    el.contentEditable = "true";
    el.spellcheck = true;
    saved.set(el.dataset.id!, el.innerHTML);
  }
}
makeEditable(document.body);

// Scripts that change a block later (once the page has loaded, after
// fetching data) lock it the same way. Watching stops when the user starts
// editing, or after a while, so it costs nothing during normal editing.
if (hashes) {
  const check = (records: MutationRecord[]) => {
    for (const r of records) {
      const el = (r.target.nodeType === 1 ? r.target as Element : r.target.parentElement)?.closest<HTMLElement>("[data-id][contenteditable=true]");
      if (el && changedByScript(el)) lockScripted(el);
    }
  };
  const watcher = new MutationObserver(check);
  watcher.observe(document.body, { childList: true, characterData: true, subtree: true });
  const userEdit = (e: Event) => {
    // Clicking into text isn't an edit yet; clicking inplace's own buttons can be.
    if (!(e.target as Element).closest?.(e.type === "pointerdown" ? "[data-inplace-ui]" : "[data-id][contenteditable=true]")) return;
    check(watcher.takeRecords());
    stopWatching();
  };
  const EVENTS = ["beforeinput", "keydown", "paste", "pointerdown"];
  const stopWatching = () => {
    watcher.disconnect();
    clearTimeout(quiet);
    for (const type of EVENTS) document.removeEventListener(type, userEdit, true);
  };
  for (const type of EVENTS) document.addEventListener(type, userEdit, true);
  const quiet = setTimeout(() => {
    check(watcher.takeRecords());
    stopWatching();
  }, 10_000);
}
