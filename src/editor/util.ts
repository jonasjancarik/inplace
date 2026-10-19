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

/**
 * Where to draw bars in the margin beside blocks. All bars share one line, left of the text edge,
 * so a table cell or a list item doesn't put a bar inside the text. A block inside another block
 * with a bar of the same colour adds nothing, and bars of one colour that nearly touch are joined,
 * so a stretch of changes reads as one line. Inner bars of another colour come later, on top.
 */
function marginBars<T extends { el: Element; colour: string }>(items: T[]) {
  const rows: (T & { top: number; bottom: number; depth: number; outer: number })[] = [];
  for (const item of items) {
    const r = item.el.getBoundingClientRect();
    if (!r.height) continue;
    // The text edge: a block around this one counts from inside its padding, as a page with wide margins would be far off.
    let outer = r.left, depth = 0, covered = false;
    for (let up = item.el.parentElement?.closest("[data-id]"); up; up = up.parentElement?.closest("[data-id]")) {
      const style = getComputedStyle(up);
      outer = Math.min(outer, up.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft));
      depth++;
      if (items.some((o) => o.el === up && o.colour === item.colour)) covered = true;
    }
    if (!covered) rows.push({ ...item, depth, top: r.top + scrollY, bottom: r.bottom + scrollY, outer });
  }
  const left = Math.max(0, Math.min(...rows.map((b) => b.outer)) + scrollX - 12);
  rows.sort((a, b) => a.top - b.top || a.depth - b.depth);
  return rows.map((row, i) => {
    const next = rows.slice(i + 1).find((n) => n.top >= row.bottom - 1);
    const bottom = next && next.colour === row.colour && next.top - row.bottom <= 32 ? next.top : row.bottom;
    return { ...row, css: `left:${left}px;top:${row.top}px;height:${bottom - row.top}px;z-index:${row.depth}` };
  });
}
