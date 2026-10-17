// --- what the changed words replaced, shown on hover ---
// Highlights aren't elements and get no mouse events, so the pointer is
// checked against the stored ranges instead. The ranges stay until the next
// reload, so this keeps working after the tint has faded. The tooltip sits
// outside every block, so it can never be saved into the file.
const rewritten = new WeakMap<Element, string>(); // element tinted as a whole -> its text from before
const tip = document.createElement("div");
tip.id = "inplace-tip";
tip.dataset.inplaceUi = "";
tip.setAttribute("role", "tooltip");
document.body.append(tip);
let tipFor: object | null = null; // the change the tooltip shows
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
// A block tinted as a whole shows its old text, if it had any and the text
// itself changed. New blocks show nothing.
function rememberRewritten(el: Element, before: string) {
  if (flat(before) && flat(before) !== flat(el.textContent!)) rewritten.set(el, flat(before));
}

interface TipChange {
  key: object;
  el: Element;
  gone: string;
  by?: "agent" | "you";
  box: DOMRect;
}

// The change under a point: a stretch of changed words, or a block that was
// rewritten as a whole, with the box the tooltip goes above.
function changeAt(x: number, y: number, target: EventTarget | null): TipChange | null {
  const inside = (r: DOMRect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  for (let el = (target as Element | null)?.closest?.("[data-id]"); el; el = el.parentElement?.closest("[data-id]")) {
    const words = wordChanges.get(el);
    if (words) {
      for (const change of words.changes) {
        const rects = [...change.range.getClientRects()].filter((r) => r.width > 0);
        if (rects.some(inside)) return { key: change, el, gone: change.gone, by: words.by, box: rects[0] };
      }
      return null;
    }
    const before = rewritten.get(el);
    if (before !== undefined) return { key: el, el, gone: before, box: el.getBoundingClientRect() };
  }
  return null;
}

function showTip(change: TipChange | null) {
  if (!change) return hideTip();
  if (tipFor === change.key) return;
  tipFor = change.key;
  tip.replaceChildren(...(change.gone
    ? ["Was: ", make("del", { textContent: clipText(change.gone, 160) })]
    : [change.by === "you" ? "Added by you" : "Added by your agent"]));
  tip.style.display = "block";
  const { box } = change, w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.max(8, Math.min(box.left, innerWidth - w - 8))}px`;
  tip.style.top = `${box.top - h - 6 >= 4 ? box.top - h - 6 : box.bottom + 6}px`;
}

function hideTip() {
  tipFor = null;
  tip.style.display = "none";
}

// One check per frame at most, however fast the pointer moves.
let tipFrame = 0, tipAt: [number, number, EventTarget | null] | null = null;
document.addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch") return;
  tipAt = e.buttons || drag ? null : [e.clientX, e.clientY, e.target];
  tipFrame ||= requestAnimationFrame(() => {
    tipFrame = 0;
    showTip(tipAt && changeAt(...tipAt));
  });
});
// On a touch screen a tap shows it, and the next tap elsewhere hides it.
// The tap still places the caret as usual.
document.addEventListener("pointerup", (e) => {
  if (e.pointerType !== "mouse") showTip(changeAt(e.clientX, e.clientY, e.target));
});
document.documentElement.addEventListener("pointerleave", hideTip);
addEventListener("scroll", hideTip, { passive: true, capture: true });
document.addEventListener("input", hideTip);
