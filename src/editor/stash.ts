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
function showStashCount(count: number | undefined) {
  if (typeof count !== "number") return;
  stashCount = count;
  updateCorner();
  if (changesPanel.classList.contains("open")) renderChanges();
  if (!count) overlay.classList.remove("open");
  else if (overlay.classList.contains("open")) renderStash();
}

// Stashed HTML is shown as text only, never inserted into the page.
const textOf = (html: string) =>
  new DOMParser().parseFromString(`<body>${html.replace(/<br\s*\/?>/gi, "\n")}`, "text/html").body.textContent!.trim();

async function renderStash() {
  let entries: StashEntry[];
  try {
    entries = (await (await fetch("/__inplace/stash")).json()).entries;
  } catch {
    return showStatus("Couldn't reach the editor server.", "error", true);
  }
  const panel = make("div", { className: "panel" },
    make("button", { className: "close", type: "button", textContent: "Close", onclick: closeStash }),
    make("h2", { textContent: "Edits set aside" }),
    make("p", { className: "intro", textContent: "You and your agent changed the same words at the same time. The document kept your agent\u2019s version, and yours is saved here so you can choose what to keep." }));
  if (!entries.length) panel.append(make("p", { textContent: "Nothing is set aside." }));
  for (const entry of entries) {
    const actions = make("div", { className: "actions" });
    const act = (label: string, action: StashAction, primary?: boolean) => make("button", {
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
        try { await navigator.clipboard.writeText(textOf(entry.mine)); (e.target as HTMLElement).textContent = "Copied"; }
        catch { (e.target as HTMLElement).textContent = "Couldn\u2019t copy"; }
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

type StashAction = "mine" | "below" | "discard";
async function resolveStash(entry: StashEntry, action: StashAction) {
  const res = await post("stash/resolve", { n: entry.n, action });
  if (!res.ok) {
    showStatus("Couldn't do that, probably because the paragraph changed again. The list is updated.", "error", true);
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
