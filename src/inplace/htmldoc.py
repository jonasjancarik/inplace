"""Find editable text blocks in an HTML file and patch them in place.

The file on disk stays the source of truth. We never re-serialise the whole
document: every change is a splice into the original text, so markup, CSS,
SVG and formatting outside the edited block stay byte-for-byte identical.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser

VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}

# Elements that can hold a run of editable text.
TEXT_CONTAINERS = {
    "p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "figcaption",
    "caption", "dt", "dd", "blockquote", "div", "label",
}

# Anything in here inside a candidate makes it a layout container, not a text block.
BLOCK_TAGS = TEXT_CONTAINERS | {
    "table", "thead", "tbody", "tfoot", "tr", "ul", "ol", "dl", "figure",
    "section", "article", "header", "footer", "nav", "aside", "main", "form",
    "svg", "canvas", "video", "audio", "iframe", "pre", "hr", "fieldset",
}

# Never editable, nor anything inside them.
LOCKED_TAGS = {"head", "script", "style", "svg", "nav", "template", "noscript", "pre", "textarea"}

# Containers that get an id so a comment on them can be traced back to the
# file, but aren't edited as a whole (their text blocks are).
ANCHOR_TAGS = {
    "table", "tr", "ul", "ol", "dl", "figure", "svg", "section", "article",
    "aside", "blockquote", "div", "header", "footer",
}

# Nothing inside these gets an id at all.
HIDDEN_TAGS = {"head", "script", "style", "template", "noscript"}

ID_ATTR = "data-id"


@dataclass
class Node:
    tag: str
    attrs: dict[str, str]
    start: int  # offset of "<"
    open_end: int  # offset just after ">" of the start tag
    parent: Node | None = None
    close_start: int | None = None  # offset of "</", None if never closed
    children: list[Node] = field(default_factory=list)
    has_text: bool = False  # non-whitespace text directly inside

    @property
    def inner(self) -> tuple[int, int] | None:
        if self.close_start is None:
            return None
        return self.open_end, self.close_start


class _TreeBuilder(HTMLParser):
    def __init__(self, source: str):
        super().__init__(convert_charrefs=True)
        self.source = source
        self.line_starts = [0] + [m.end() for m in re.finditer(r"\n", source)]
        self.root = Node("#root", {}, 0, 0)
        self.stack = [self.root]

    def _offset(self) -> int:
        line, col = self.getpos()
        return self.line_starts[line - 1] + col

    def handle_starttag(self, tag, attrs):
        start = self._offset()
        text = self.get_starttag_text() or ""
        node = Node(tag, {k: (v or "") for k, v in attrs}, start, start + len(text), self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in VOID_TAGS and not text.endswith("/>"):
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        start = self._offset()
        text = self.get_starttag_text() or ""
        node = Node(tag, {k: (v or "") for k, v in attrs}, start, start + len(text), self.stack[-1])
        self.stack[-1].children.append(node)

    def handle_endtag(self, tag):
        # Pop to the matching open element; anything skipped stays unclosed
        # and is therefore never offered for editing.
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack[i].close_start = self._offset()
                del self.stack[i:]
                return

    def handle_data(self, data):
        if data.strip():
            self.stack[-1].has_text = True


def parse(source: str) -> Node:
    builder = _TreeBuilder(source)
    builder.feed(source)
    builder.close()
    return builder.root


def _walk(node: Node):
    for child in node.children:
        yield child
        yield from _walk(child)


def _is_locked(node: Node) -> bool:
    n: Node | None = node
    while n is not None:
        if n.tag in LOCKED_TAGS:
            return True
        if "data-locked" in n.attrs or n.attrs.get("contenteditable") == "false":
            return True
        n = n.parent
    return False


def _contains_text(node: Node) -> bool:
    return node.has_text or any(_contains_text(c) for c in node.children if c.tag not in LOCKED_TAGS)


def _contains_block(node: Node) -> bool:
    return any(d.tag in BLOCK_TAGS for d in _walk(node))


def is_editable_block(node: Node) -> bool:
    return (
        node.tag in TEXT_CONTAINERS
        and node.close_start is not None
        and not _is_locked(node)
        and not _contains_block(node)
        and _contains_text(node)
    )


def editable_blocks(root: Node) -> list[Node]:
    return [n for n in _walk(root) if is_editable_block(n)]


def is_anchor(node: Node) -> bool:
    if node.tag not in ANCHOR_TAGS or node.close_start is None or is_editable_block(node):
        return False
    n = node.parent
    while n is not None:
        if n.tag in HIDDEN_TAGS or n.tag == "svg":
            return False
        n = n.parent
    return True


def editable_ids(source: str) -> list[str]:
    """Ids of the blocks whose text may be edited in the browser."""
    return [n.attrs[ID_ATTR] for n in editable_blocks(parse(source)) if ID_ATTR in n.attrs]


def assign_ids(source: str) -> tuple[str, int]:
    """Give every editable block and container without an id a short, unique data-id.

    Returns the new source and the number of ids added. Existing ids are kept,
    so ids the agent or a comment already refers to never move.
    """
    root = parse(source)
    used = {n.attrs[ID_ATTR] for n in _walk(root) if ID_ATTR in n.attrs}
    counters: dict[str, int] = {}

    def next_id(tag: str) -> str:
        n = counters.get(tag, 0)
        while True:
            n += 1
            candidate = f"{tag}-{n}"
            if candidate not in used:
                counters[tag] = n
                used.add(candidate)
                return candidate

    inserts = []
    for node in _walk(root):
        if ID_ATTR not in node.attrs and (is_editable_block(node) or is_anchor(node)):
            inserts.append((node.start + 1 + len(node.tag), f' {ID_ATTR}="{next_id(node.tag)}"'))

    for offset, text in reversed(inserts):
        source = source[:offset] + text + source[offset:]
    return source, len(inserts)


def find_block(root: Node, block_id: str) -> Node | None:
    for node in _walk(root):
        if node.attrs.get(ID_ATTR) == block_id:
            return node
    return None


class _Canon(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tokens: list[tuple] = []
        self.text: list[str] = []

    def _flush(self):
        if self.text:
            self.tokens.append(("t", " ".join("".join(self.text).split())))
            self.text = []

    def handle_starttag(self, tag, attrs):
        self._flush()
        self.tokens.append(("s", tag, tuple(sorted((k, v or "") for k, v in attrs))))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        self._flush()
        self.tokens.append(("e", tag))

    def handle_data(self, data):
        self.text.append(data.replace("\xa0", " "))


def canonical(fragment: str) -> list[tuple]:
    """Normalise an HTML fragment so source text and browser innerHTML compare equal.

    Browsers re-serialise entities, quoting, void tags and whitespace; none of
    that should count as a change.
    """
    parser = _Canon()
    parser.feed(fragment)
    parser.close()
    parser._flush()
    return [t for t in parser.tokens if t != ("t", "")]


class BlockNotFound(Exception):
    pass


class BlockConflict(Exception):
    def __init__(self, current: str):
        super().__init__("block changed on disk")
        self.current = current


def patch_block(source: str, block_id: str, old_inner: str, new_inner: str) -> str:
    """Replace the inner HTML of one block, if nobody else changed it meanwhile.

    `old_inner` is what the browser showed before the edit. If the block on
    disk no longer matches it (the agent edited the same block), raise
    BlockConflict rather than overwrite the agent's text.
    """
    node = find_block(parse(source), block_id)
    if node is None or not is_editable_block(node):
        raise BlockNotFound(block_id)
    a, b = node.inner
    current = source[a:b]
    if canonical(current) == canonical(new_inner):
        return source
    if canonical(current) != canonical(old_inner):
        raise BlockConflict(current)
    return source[:a] + new_inner + source[b:]
