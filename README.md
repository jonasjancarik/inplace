# inplace

Edit a hand-written HTML document directly in the browser while a coding agent (Claude Code, Codex) edits the same file. You fix wording by typing on the rendered page; for bigger changes you leave a comment on the page with the browser's built-in comment tool, and the agent edits the file. The page reloads whenever the file changes.

The HTML file stays the only source of truth. inplace never rewrites the whole document. Each edit you make replaces the inside of one paragraph, heading, list item or table cell in the file, and everything else, including CSS, SVG and print layout, stays exactly as it was.

## Usage

inplace needs [uv](https://docs.astral.sh/uv/). Run it without installing:

```bash
uvx --from git+https://github.com/jonasjancarik/inplace inplace path/to/document.html
```

or install the `inplace` command once:

```bash
uv tool install git+https://github.com/jonasjancarik/inplace
```

Then open `http://localhost:8765/` in the built-in browser of Claude or Codex. Options: `--port`, `--host` (default `0.0.0.0`; use `127.0.0.1` to keep the document off the local network), `--no-write-ids`.

To try it, copy the example first, since inplace writes to the file it serves:

```bash
cp examples/garden-proposal.html /tmp/ && inplace /tmp/garden-proposal.html
```

## How it works

- **Block ids.** When the page is opened, inplace adds a `data-id` attribute (`p-3`, `td-12`, `table-1`, …) to every element that doesn't have one yet: each text block (the innermost `p`, `li`, `h1`–`h6`, `td`, `th`, `figcaption`, `div` and similar elements that contain text but no other blocks), and each container around them (`table`, `tr`, `ul`, `figure`, `svg`, `section`, `div`, …). Existing ids are never changed. The ids are what make comments useful: a comment on an element arrives with its `data-id`, so the agent can find the exact element in the file even after the wording changed. Containers carry an id only for that; their text blocks are what you edit. Adding ids is the only change inplace makes to the file on its own; commit it like any other edit.
- **What you can edit.** Only the text of those blocks. Enter leaves the block (Shift+Enter adds a line break), paste is plain text, and formatting the browser adds while typing is removed. Adding, removing or moving blocks, and anything to do with layout, is a job for the agent.
- **What you can't edit.** Anything in `<svg>`, `<nav>`, `<script>`/`<style>`, and anything marked `data-locked` or `contenteditable="false"`. Use `data-locked` for content that should only change from its data source.
- **Saving.** Edits are saved 0.6 s after you stop typing, when you leave a block, or with ⌘S.
- **Agent edits.** The server watches the file. When it changes, open pages save any pending edits and reload, keeping the scroll position and the block you were in.
- **Conflicts.** Each save sends what the block looked like before your edit. If the agent changed the same block in the meantime, the save is refused, your text goes to the clipboard and the page shows the agent's version, highlighted. Edits to different blocks never conflict.

## Agent skill

The repository includes an `inplace` skill that teaches Claude Code, Codex and other agents how to start inplace, find a commented element by its `data-id`, keep ids intact, and keep numbers consistent after the user edits them. Install it with the [skills CLI](https://skills.sh):

```bash
npx skills add jonasjancarik/inplace
```

## Development

```bash
uv run --group dev pytest
```

To use a local checkout's skill while working on it, link `skills/inplace` into your agent's skills folder, e.g. `ln -s "$PWD/skills/inplace" ~/.claude/skills/inplace`.
