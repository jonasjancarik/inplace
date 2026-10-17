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
