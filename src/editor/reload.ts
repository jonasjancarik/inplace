// --- live reload when the file changes on disk (agent edits) ---
function rememberConflict(id: string) {
  try { sessionStorage.setItem(`${STATE_KEY}:conflict`, JSON.stringify({ id })); } catch {}
}

// Sparkles shown with the agent's changes.
const STAR = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 0C12.8 7.4 16.6 11.2 24 12 16.6 12.8 12.8 16.6 12 24 11.2 16.6 7.4 12.8 0 12 7.4 11.2 11.2 7.4 12 0Z"/></svg>';
const SPARKLE_COLORS = ["#f1d27a", "#b39cff", "#f4a9cf", "#fff3d1"];

// A short hash of what a block holds, as the file has it. Blocks nested
// inside count only by their id, so a container changes only when its own
// content does, such as a row being added or removed.
const tpl = document.createElement("template");
function fingerprint(el: HTMLElement) {
  // A block a script had already filled in when the page loaded: what the file has.
  if (scripted.has(el.dataset.id!) && !saved.has(el.dataset.id!)) return `script:${hashes![el.dataset.id!]}`;
  tpl.innerHTML = saved.get(el.dataset.id!) ?? el.innerHTML;
  for (const inner of tpl.content.querySelectorAll<HTMLElement>("[data-id]")) inner.replaceWith(`\u0001${inner.dataset.id}\u0001`);
  const text = tpl.innerHTML;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** A block as it was before a reload: its id, fingerprint and the id of the block it's in. */
type BlockPrint = [id: string, hash: string, parent: string | undefined];

/** What a reload keeps in sessionStorage for the page that comes next. */
interface ReloadState {
  x: number;
  y: number;
  focus?: string;
  blocks?: BlockPrint[];
  skip?: string[];
  unseen?: string[];
  texts?: Record<string, string>;
  changes?: boolean;
}

// `skip` lists blocks the user changed themselves, so they aren't shown as
// the agent's changes after the reload.
async function reload(skip: string[] = []) {
  for (const id of pending()) {
    const el = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (el && !(await save(el))) return; // a conflict reloads on its own
  }
  const active = document.activeElement?.closest?.<HTMLElement>("[data-id]");
  const blocks = [...document.querySelectorAll<HTMLElement>("[data-id]")].map((el): BlockPrint =>
    [el.dataset.id!, fingerprint(el), el.parentElement?.closest<HTMLElement>("[data-id]")?.dataset.id]);
  // Changes the user hasn't seen yet stay marked after the next reload.
  const unseen = [...document.querySelectorAll<HTMLElement>("[data-id].inplace-changed, [data-id].inplace-changed-words")]
    .map((el) => el.dataset.id);
  // The text of each paragraph, so the changed words can be found after the
  // reload. For changes not seen yet, the text from before those changes.
  const texts: Record<string, string> = {};
  for (const el of document.querySelectorAll<HTMLElement>("[data-id][contenteditable]"))
    texts[el.dataset.id!] = el.classList.contains("inplace-changed-words") ? wordChanges.get(el)!.before : el.textContent!;
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ x: scrollX, y: scrollY, focus: active?.dataset.id, blocks, skip, unseen,
      texts, changes: changesPanel.classList.contains("open") }));
  } catch {}
  rememberWriting();
  location.reload();
}

let reopenChanges = false; // the list of changes was open before the reload
function restore() {
  let state: ReloadState | null | undefined;
  try { state = JSON.parse(sessionStorage.getItem(STATE_KEY) || "null"); sessionStorage.removeItem(STATE_KEY); } catch {}
  if (state) {
    reopenChanges = !!state.changes;
    scrollTo(state.x, state.y);
    const el = state.focus && document.querySelector<HTMLElement>(`[data-id="${CSS.escape(state.focus)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    }
  }
  let conflict: { id: string } | null | undefined;
  try { conflict = JSON.parse(sessionStorage.getItem(`${STATE_KEY}:conflict`) || "null"); sessionStorage.removeItem(`${STATE_KEY}:conflict`); } catch {}
  if (conflict) {
    const el = document.querySelector(`[data-id="${CSS.escape(conflict.id)}"]`);
    el?.classList.add("inplace-conflict");
    showStatus("The highlighted paragraph shows your agent\u2019s version. Yours is under \u201cSet aside\u201d at the bottom left.", "error", true);
  }
  if (state?.blocks) showChanges(state.blocks, new Set([...(state.skip || []), ...(conflict ? [conflict.id] : [])]), !!conflict, state.unseen || [], state.texts || {});
}
restore();
