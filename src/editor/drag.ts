// --- dragging an element to another place among its siblings ---
let movable = new Set((script.dataset.movable || "").split(" ").filter(Boolean));
const isMovable = (el: HTMLElement) => !!el.dataset?.id && movable.has(el.dataset.id) && !el.closest("[data-locked]");
const siblingsOf = (el: HTMLElement) =>
  [...el.parentElement!.children as HTMLCollectionOf<HTMLElement>].filter((s) => s !== el && isMovable(s));
const NAMES: Record<string, string | undefined> = {
  P: "paragraph", LI: "list item", TR: "row", TABLE: "table", FIGURE: "figure", SECTION: "section",
  UL: "list", OL: "list", DL: "list", BLOCKQUOTE: "quote", ARTICLE: "section", ASIDE: "box",
};
const nameOf = (el: Element) => NAMES[el.tagName] || (/^H\d$/.test(el.tagName) ? "heading" : "block");

const ui = document.createElement("div");
ui.id = "inplace-ui";
ui.dataset.inplaceUi = "";
document.body.append(ui);
let grips: HTMLElement[] = []; // elements showing a grip, innermost first
let hoverTimer: number | null = null;

/** Where a dragged element would go if dropped now. */
interface Drop {
  target: HTMLElement;
  position: "before" | "after";
  r: DOMRect;
  unchanged: boolean;
}
let drag: { el: HTMLElement; siblings: HTMLElement[]; drop: Drop | null; vertical: boolean } | null = null;

function chainAt(node: HTMLElement) {
  const chain: HTMLElement[] = [];
  for (let el: HTMLElement | null = node; el && el !== document.body; el = el.parentElement) {
    if ((isMovable(el) && siblingsOf(el).length) || canAdd(el)) chain.push(el);
  }
  return chain.slice(0, 3);
}

const canAdd = (el: HTMLElement) => !!el.dataset?.id && INSERTABLE.has(el.tagName) && !el.closest("[data-locked]") &&
  (editable.has(el.dataset.id) || el.tagName === "TR" || el.tagName === "LI");
const ADD_LABELS: Record<string, string | undefined> = { LI: "Add an item below", TR: "Add a row below", DT: "Add a term below", DD: "Add a description below" };

function outline(el: Element | null) {
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

function showGrips(chain: HTMLElement[]) {
  clearTimeout(hoverTimer!);
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
        (document.activeElement as HTMLElement | null)?.blur();
        showGrips([]);
        insertNear(el, { tag: isHeading(el) ? "p" : el.tagName.toLowerCase() });
      });
      ui.append(plus);
    }
    if (!(isMovable(el) && siblingsOf(el).length)) return;
    const grip = document.createElement("button");
    grip.type = "button";
    grip.className = "inplace-grip";
    grip.dataset.index = String(depth);
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

const sameChain = (a: Element[], b: Element[]) => a.length === b.length && a.every((el, i) => el === b[i]);

document.addEventListener("mousemove", (e) => {
  if (drag || reviewing) return;
  if ((e.target as Element).closest?.(".inplace-grip")) {
    clearTimeout(hoverTimer!);
    hoverTimer = null;
    return;
  }
  let chain = chainAt(e.target as HTMLElement);
  // Over the margin to the left of a block, on the way to its grip.
  if (!chain.length || !chain[0].contains(e.target as Node)) {
    const probe = document.elementFromPoint(e.clientX + 40, e.clientY);
    if (probe) chain = chainAt(probe as HTMLElement);
  }
  if (sameChain(chain, grips)) {
    clearTimeout(hoverTimer!);
    hoverTimer = null;
  } else if (!hoverTimer) {
    hoverTimer = setTimeout(() => showGrips(chain), grips.length ? 300 : 0);
  }
}, { passive: true });
addEventListener("scroll", () => drag || showGrips([]), { passive: true, capture: true });

function dropAt(x: number, y: number): Drop {
  let best: { target: HTMLElement; r: DOMRect } | null = null;
  let bestDist = Infinity;
  for (const s of drag!.siblings) {
    const r = s.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    if (dx * dx + dy * dy < bestDist) {
      bestDist = dx * dx + dy * dy;
      best = { target: s, r };
    }
  }
  const { target, r } = best!;
  const before = drag!.vertical ? y < r.top + r.height / 2 : x < r.left + r.width / 2;
  const position = before ? "before" : "after";
  const unchanged = before ? target.previousElementSibling === drag!.el : target.nextElementSibling === drag!.el;
  return { target, position, r, unchanged };
}

function showMarker(drop: Drop) {
  let marker = document.getElementById("inplace-marker");
  if (!marker) {
    marker = document.createElement("div");
    marker.id = "inplace-marker";
    ui.append(marker);
  }
  marker.style.display = drop.unchanged ? "none" : "";
  const { r } = drop;
  const edge = drop.position === "before";
  Object.assign(marker.style, drag!.vertical
    ? { left: `${r.left}px`, top: `${(edge ? r.top : r.bottom) - 2}px`, width: `${r.width}px`, height: "4px" }
    : { left: `${(edge ? r.left : r.right) - 2}px`, top: `${r.top}px`, width: "4px", height: `${r.height}px` });
}

ui.addEventListener("pointerdown", (e) => {
  const grip = (e.target as Element).closest<HTMLElement>(".inplace-grip:not(.inplace-add)");
  if (!grip || e.button !== 0) return;
  e.preventDefault();
  const el = grips[Number(grip.dataset.index)];
  const siblings = siblingsOf(el);
  if (!siblings.length) return;
  if (document.activeElement && el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  const items = [el, ...siblings].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const [ra, rb] = items.slice(0, 2).map((n) => n.getBoundingClientRect());
  drag = { el, siblings, drop: null, vertical: rb.top >= ra.bottom - 2 || rb.bottom <= ra.top + 2 };
  formatToolbar.style.display = "none";
  for (const g of ui.querySelectorAll<HTMLElement>(".inplace-grip")) g.style.visibility = g === grip ? "" : "hidden";
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
  const state = drag!;
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
  showStatus("Saving…", "info", true);
  const res = await post("move", { id: el.dataset.id, target: drop.target.dataset.id, position: drop.position });
  if (res.ok) {
    version = res.body.version;
    rememberUndo("move", el.dataset.id!);
    return offerUndo("Moved.", "move", el.dataset.id!);
  }
  showStatus("Couldn't move this here, probably because the file changed in the meantime. The page will reload.", "error", true);
  setTimeout(reload, 1800);
});
document.addEventListener("keydown", (e) => {
  if (drag && e.key === "Escape") endDrag();
});
