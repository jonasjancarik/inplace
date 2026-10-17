// --- undoing the user's own moves, additions, removals and heading changes ---
// The server reverses them, so an undo also works after a reload. The steps
// this page made are kept for Cmd/Ctrl+Z, newest last.
const UNDO_KEY = `${STATE_KEY}:undo`;
let undoSteps: { kind: UndoKind; id: string; at: number }[] = [];
try { undoSteps = JSON.parse(sessionStorage.getItem(UNDO_KEY) || "[]"); } catch {}
// Typing after a step leaves Cmd/Ctrl+Z to the browser, which undoes the typing.
let lastInputAt = 0;
document.addEventListener("input", () => { lastInputAt = Date.now(); });

function rememberUndo(kind: UndoKind, id: string) {
  undoSteps = [...undoSteps.filter((s) => !(s.kind === kind && s.id === id)), { kind, id, at: Date.now() }].slice(-50);
  try { sessionStorage.setItem(UNDO_KEY, JSON.stringify(undoSteps)); } catch {}
}

function offerUndo(text: string, kind: UndoKind, id: string) {
  showStatus(text, "info", 6000);
  pill.append(make("button", { type: "button", textContent: "Undo", onclick: () => undoChange(kind, id) }));
}

async function undoChange(kind: UndoKind, id: string) {
  undoSteps = undoSteps.filter((s) => !(s.kind === kind && s.id === id));
  try { sessionStorage.setItem(UNDO_KEY, JSON.stringify(undoSteps)); } catch {}
  for (const pendingId of pending()) {
    const el = document.querySelector<HTMLElement>(`[data-id="${CSS.escape(pendingId)}"]`);
    if (el && !(await save(el))) return;
  }
  const res = await post("undo", { kind, id });
  if (!res.ok) {
    showStatus(res.body.error || "Couldn't undo this.", "error", 6000);
    return loadHistory();
  }
  version = res.body.version;
  // Reload to show the file as it is now, without marking the undone change
  // as one of the agent's.
  reload([...document.querySelectorAll<HTMLElement>("[data-id]")].map((el) => el.dataset.id!).concat(id));
}

document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "z" || composing(e)) return;
  if ((e.target as Element).closest?.("input, textarea, [data-inplace-ui]")) return;
  const step = undoSteps.at(-1);
  if (!step || lastInputAt > step.at || reviewing) return;
  e.preventDefault();
  undoChange(step.kind, step.id);
});
