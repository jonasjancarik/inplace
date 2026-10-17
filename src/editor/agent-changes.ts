// --- what the agent changed since the page last loaded ---
// Changed and new blocks are tinted, and the tint fades once the block has
// been on screen for a moment. `quiet` leaves the status message to a conflict.
function showChanges(before: BlockPrint[], skip: Set<string>, quiet: boolean, earlier: string[], texts: Record<string, string>) {
  if (reviewScope()) return; // review mode marks every change already
  const old = new Map(before.map(([id, hash, parent]): [string, { hash: string; parent?: string }] => [id, { hash, parent }]));
  const now = new Map([...document.querySelectorAll<HTMLElement>("[data-id]")].map((el): [string, HTMLElement] => [el.dataset.id!, el]));
  const added: HTMLElement[] = [], changed: HTMLElement[] = [];
  for (const [id, el] of now) {
    if (skip.has(id)) continue;
    if (!old.has(id)) added.push(el);
    else if (old.get(id)!.hash !== fingerprint(el) || earlier.includes(id)) changed.push(el);
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
  // A block in a closed <details> or hidden tab panel counts as out of view.
  const inView = (el: Element) => {
    const r = el.getBoundingClientRect();
    return isShown(el) && r.bottom > innerHeight * 0.1 && r.top < innerHeight * 0.9;
  };
  const total = marks.length + removed;
  const summary = marks.length
    ? total === 1 ? "Your agent made a change." : `Your agent made ${total} changes.`
    : removed === 1 ? "Your agent removed a paragraph." : `Your agent removed ${removed} paragraphs.`;
  // `lead` takes the summary's place once, to say why Show didn't scroll.
  function render(lead = "") {
    if (quiet) return;
    const star = () => {
      const icon = make("span", { className: "star" });
      icon.innerHTML = STAR;
      pill.prepend(icon);
      pill.dataset.owner = "changes";
    };
    if (!unseen.size) {
      showStatus(lead || summary, "info", 4000);
      return star();
    }
    const more = lead ? (unseen.size === 1 ? "One more is" : `${unseen.size} more are`) : unseen.size === 1 ? "One is" : `${unseen.size} are`;
    showStatus(`${lead || summary} ${more} out of view.`, "info", true);
    star();
    pill.append(make("button", { type: "button", textContent: "Show", onclick: async () => {
      const next = [...unseen][0];
      if (!next) return;
      if (await uncover(next)) {
        return next.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
      // Still hidden: move on to the next one. Its tint plays when it's shown.
      unseen.delete(next);
      observer.unobserve(next);
      reveal(next);
      render(HIDDEN_CHANGE);
    } }));
  }
  function seen(el: HTMLElement) {
    if (!unseen.delete(el)) return;
    observer.unobserve(el);
    reveal(el);
    if (pill.dataset.owner === "changes") render();
  }
  // In a background tab nothing counts as seen until the tab is shown.
  const observer = new IntersectionObserver((entries) => {
    if (document.hidden) return;
    for (const e of entries) if (e.isIntersecting && isShown(e.target)) seen(e.target as HTMLElement);
  }, { rootMargin: "-10% 0px -10% 0px" });
  const check = () => { if (!document.hidden) for (const el of [...unseen]) if (inView(el)) seen(el); };
  document.addEventListener("visibilitychange", check);
  // Opening a <details> doesn't move what's inside it, so no intersection is reported.
  document.addEventListener("toggle", check, true);
  for (const el of marks) {
    const id = el.dataset.id!;
    if (!(old.has(id) && texts[id] !== undefined && tintWords(el, texts[id]))) {
      el.classList.add("inplace-changed");
      if (old.has(id) && texts[id] !== undefined) rememberRewritten(el, texts[id]);
    }
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
function reveal(el: Element) {
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
  if (e.animationName === "inplace-fade") (e.target as Element).classList?.remove("inplace-changed-fade");
});

// Show a block's change again, as when it first appeared. With the text from
// before the change, only the changed words light up.
function replay(el: HTMLElement, before: string | undefined, by: "agent" | "you") {
  el.classList.remove("inplace-changed", "inplace-changed-fade", "inplace-changed-words");
  const words = wordChanges.get(el);
  if (words) clearWords(el, words);
  rewritten.delete(el);
  hideTip();
  void el.offsetWidth;
  if (before === undefined || !tintWords(el, before, by)) {
    el.classList.add("inplace-changed");
    if (before !== undefined) rememberRewritten(el, before);
  }
  reveal(el);
}
