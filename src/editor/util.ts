// A new element with the given properties and children.
function make<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

const clipText = (s: string, max = 220) => (s.length > max ? s.slice(0, max) + "\u2026" : s);

/** The left and right of a block's text, counting a table cell or a list item as its whole table or list. */
function textSpan(el: Element) {
  const r = (el.closest("table, ul, ol, dl") ?? el).getBoundingClientRect();
  return { left: r.left, right: r.right };
}

/**
 * Where to draw bars in the margin beside blocks, so a table cell or a list item doesn't put a bar
 * inside the text. Blocks stacked in one column share one line just left of it; blocks side by side
 * get a line each. The columns come from `all`, every block with a bar of any kind, so different
 * kinds of bars line up. With no room on the left, the line goes to the right of the text, and with
 * no room on either side it sits on the text's edge. A block inside another block with a bar of the
 * same colour adds nothing, bars of one colour that nearly touch are joined, so a stretch of changes
 * reads as one line, and inner bars of another colour come later, on top.
 */
function marginBars<T extends { el: Element; colour: string }>(items: T[], all: Element[]) {
  // Two blocks are in one column when they overlap across the page and are about as wide, so a
  // heading that spans two columns doesn't pull them together.
  const spans = [...new Set([...all, ...items.map((i) => i.el)])].map((el) => ({ el, ...textSpan(el), group: -1 }));
  const sameColumn = (a: typeof spans[0], b: typeof spans[0]) => {
    const wa = a.right - a.left, wb = b.right - b.left;
    return a.left < b.right && b.left < a.right && Math.max(wa, wb) <= 1.5 * Math.min(wa, wb);
  };
  spans.forEach((span, i) => {
    if (span.group >= 0) return;
    span.group = i;
    for (const queue = [span]; queue.length;) {
      const at = queue.pop()!;
      for (const other of spans) if (other.group < 0 && sameColumn(at, other)) { other.group = i; queue.push(other); }
    }
  });
  const width = document.documentElement.clientWidth;
  const columnX = new Map<number, number>();
  for (const group of new Set(spans.map((s) => s.group))) {
    const members = spans.filter((s) => s.group === group);
    const left = Math.min(...members.map((s) => s.left)), right = Math.max(...members.map((s) => s.right));
    columnX.set(group, (left >= 12 ? left - 12 : width - right >= 12 ? right + 2 : Math.max(0, left - 3)) + scrollX);
  }
  const groupOf = new Map(spans.map((s) => [s.el, s.group]));

  const rows: (T & { top: number; bottom: number; depth: number; x: number })[] = [];
  for (const item of items) {
    const r = item.el.getBoundingClientRect();
    if (!r.height) continue;
    let depth = 0, covered = false;
    for (let up = item.el.parentElement?.closest("[data-id]"); up; up = up.parentElement?.closest("[data-id]")) {
      depth++;
      if (items.some((o) => o.el === up && o.colour === item.colour)) covered = true;
    }
    if (!covered) rows.push({ ...item, depth, top: r.top + scrollY, bottom: r.bottom + scrollY, x: columnX.get(groupOf.get(item.el)!)! });
  }
  rows.sort((a, b) => a.top - b.top || a.depth - b.depth);
  return rows.map((row, i) => {
    const next = rows.slice(i + 1).find((n) => n.x === row.x && n.top >= row.bottom - 1);
    const bottom = next && next.colour === row.colour && next.top - row.bottom <= 32 ? next.top : row.bottom;
    return { ...row, css: `left:${row.x}px;top:${row.top}px;height:${bottom - row.top}px;z-index:${row.depth}` };
  });
}
