---
name: inplace
description: Co-edit a hand-written HTML document with the user through inplace, a local server that lets them type into the rendered page and comment on it in the browser while you edit the same file. Use when the user wants to edit or review an HTML document (report, handout, proposal) in the browser together with you, mentions inplace, or sends a browser comment on an element that has a data-id attribute.
---

# Co-editing an HTML document with inplace

inplace serves one HTML file with a small editing script. On the rendered page the user can fix wording, add simple formatting (bold, italic, strikethrough, code, links, paragraph ↔ heading) and drag elements to a new place among their siblings. They ask for bigger changes by commenting on elements with the browser's comment tool. You edit the file on disk. Every open page reloads when the file changes, so neither side has to refresh anything.

The HTML file is the only source of truth. There is no separate content store, export step or build.

## Starting it

inplace needs Node.js 22 or newer. Run it with npx, with no install step:

```bash
npx -y github:jonasjancarik/inplace path/to/document.html --port 8765
```

If the user has installed it (`npm install -g github:jonasjancarik/inplace`), `inplace path/to/document.html` is enough.

- Run it in the background; it keeps running until stopped. Check the port is free first and pick another if not. Keep hold of its output: that's where the user's edits are reported (see below).
- It listens on all interfaces by default (`--host 0.0.0.0`) and prints the URLs it can be reached at. Use `--host 127.0.0.1` if the document shouldn't be reachable from other machines on the network.
- Open the localhost URL in your built-in browser if you have one, so the user can type and comment there. Otherwise give the user the URL.
- One server per document. Stop it when the user is done with the document.

The first time the page is opened, inplace adds `data-id` attributes to the file (`p-3`, `td-12`, `table-1`, …). This is expected. If the document is under version control, commit that change on its own before content edits, so later diffs stay readable. Pass `--no-write-ids` only if the file must not be changed this way; the browser then can't edit or anchor blocks without an id.

## What the ids mean

- **Text blocks** (innermost `p`, `li`, `h1`–`h6`, `td`, `th`, `figcaption`, text-only `div`, …) are editable in the browser. Each save from the browser replaces only the inside of one such block. The user can also switch a `p` to `h1`–`h3` and back; the element keeps its `data-id` (so an `h2` may have the id `p-3`).
- **Containers** (`table`, `tr`, `ul`, `ol`, `li` with blocks inside, `figure`, `svg`, `section`, `div` with blocks inside, …) have ids so comments on them can be traced and so they can be dragged. The user can't edit them as a whole; you can.
- **Moving:** the user can drag any element with an id (except table cells, captions and table sections) to another place among its siblings. The element is moved unchanged, never into a different parent.
- Elements with `data-locked` or `contenteditable="false"`, and anything in `<svg>`, `<nav>`, `<script>` and `<style>`, can't be edited in the browser.
- The `contenteditable` and `spellcheck` attributes you may see in comment payloads are added by the page script. They aren't in the file; don't add them.

## Handling a browser comment

A comment usually arrives with the selected element's HTML (including its `data-id`), a CSS path to its parent, a shortened text excerpt, its siblings, and a screenshot. The exact format depends on the agent.

1. Check the inplace output for edits the user made since you last looked (see below), and deal with any that affect what the comment is about.
2. Take the `data-id` from the element's HTML and find it in the file, e.g. `grep -n 'data-id="p-3"' document.html`. Don't search by text: the excerpt may be cut off and the user may have changed the wording since.
3. If the element has no `data-id` (an inline `strong`, `span` or `a` inside a block, or something inplace skips), use the surrounding text and the screenshot to find it, then work on the nearest element with an id.
4. Re-read that part of the file right before editing. The user may be typing in the same document, and their saves change the file under you.
5. Make the change. The page reloads by itself; don't tell the user to refresh.
6. Reply briefly with what you changed. For wording changes, quote the new text.

## Editing rules

- **Keep `data-id` attributes** when you rewrite, move or restyle an element. They're how comments and the user's open page find it.
- **Don't invent ids for new elements.** Leave them out; inplace assigns one on the next page load. Never reuse an id for a different element.
- **Deleting an element deletes its id.** That's fine.
- **Edit the smallest region that does the job.** Make small, separate edits rather than rewriting a whole section at once. If the user is typing in a block you replace wholesale, their save is refused as a conflict: their text goes to their clipboard, so nothing is lost, but it's disruptive.
- **Keep the file valid.** inplace reads it the way a browser does, so badly nested markup can end up in a different block than it looks like in the source.
- The user can change text, add `<strong>`, `<em>`, `<s>`, `<code>` and `<a href>` inside a block, turn paragraphs into headings and reorder siblings. Adding or removing paragraphs, rows or sections, moving things to a different parent, changing layout or styles, and anything inside SVG charts is your job when they ask in a comment.

## Numbers and other calculated content

The user can edit any text, including amounts in table cells, and nothing recalculates by itself. When you see that the user changed a number (in a comment or in a diff), find every place derived from it (totals, differences, percentages, chart bars and labels, the same figure repeated elsewhere) and update them, or tell the user what still disagrees. If the document is generated from a data file, change the data and regenerate rather than editing the derived HTML. Suggest `data-locked` for values the user shouldn't change by hand.

## Seeing what the user changed

The user's edits go straight into the file, and inplace prints one line per change to its output:

```text
16:34:18 edited p-1: "…into a shared vegetable…" → "…into a <strong>shared</strong> vegetable…"
16:34:52 changed p-3 from <p> to <h2>
16:35:21 moved li-1 before li-3 (inside ul-1)
```

Edits show only the changed part of the block. Read the new lines whenever you come back to the document: before handling a comment, before your own edits, and when the user says they've made changes. Act on what they imply without being asked:

- A changed number: update totals, percentages, chart bars and labels, and repeats of the same figure (see below).
- A moved element: fix references that depend on order, such as "see the table below", "Figure 2" or manual numbering, and tell the user if the move breaks the flow.
- A paragraph turned into a heading: check it fits the document's heading levels and any table of contents.

For the full picture, diff the document against the last commit. If the document is under version control, commit at natural points, such as after a round of comments, so the user's edits and yours stay readable.

## Troubleshooting

- **Page doesn't reload after your edit:** check the server is still running and serving the same file path you edited.
- **A block isn't editable in the browser:** it contains another block (so its children are the editable units), or it's inside a locked element.
- **No drag handle on an element:** it has no id yet (reload the page), has no sibling that can move, is locked, or is a table cell or caption.
- **User says their edit disappeared:** it hit a conflict with your edit to the same block. Their text is on their clipboard; offer to merge it in.
