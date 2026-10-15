# inplace

**Edit an HTML document on the page while your coding agent edits the same file.**

Coding agents have become good at writing documents as hand-crafted HTML: reports, proposals, handouts, meeting packets, with real typography, tables, charts and print layouts. Working on them together is still awkward. To change a word, you either edit raw markup or describe the change to the agent and wait. And as soon as you open the page in a rich-text editor, it rewrites the HTML into its own format and the layout falls apart.

inplace takes a different approach. It serves your HTML file exactly as it is and lets you click into the rendered page and type. For anything bigger, such as rewording a section, adding a row or fixing a chart, you leave a comment on the page with the browser's comment tool in Claude or Codex, and the agent edits the file. Every open page reloads as soon as the file changes, so you always see the current version.

```bash
npx inplace-html report.html
```

## Why it works this way

- **The HTML file is the document.** There's no separate editor format, database or export step. What you see in the browser is the file on disk, and what you print or send is that same file.
- **Your edits are surgical.** Typing changes the text inside one paragraph, heading, list item or table cell, and nothing else. CSS, SVG charts, print styles and the rest of the markup stay byte-for-byte as they were, so `git diff` shows exactly what you changed.
- **Comments point at the right place.** inplace gives every block a stable `data-id`. When you comment on an element, the agent receives that id and finds the exact spot in the file, even if the wording has changed since.
- **You and the agent can work at the same time.** Edits to different blocks never get in each other's way. If the agent rewrites the paragraph you're typing in, your save is refused instead of overwriting the agent's text, and what you typed goes to your clipboard.

## Getting started

You need Node.js 22 or newer.

1. Start inplace on your document:

   ```bash
   npx inplace-html path/to/document.html
   ```

   Or install it once with `npm install -g inplace-html` and run `inplace path/to/document.html`.

2. Open `http://localhost:8765/` in the built-in browser of Claude or Codex.

3. Click into any paragraph, heading, list item or table cell and type. Changes are saved after a short pause, when you click elsewhere, or with ⌘S / Ctrl+S.

4. To ask for something bigger, comment on an element with the browser's comment tool. Install the agent skill (below) so the agent knows how to handle it.

To try it on the example, copy it first, because inplace writes to the file it serves:

```bash
cp examples/garden-proposal.html /tmp/ && npx inplace-html /tmp/garden-proposal.html
```

## The agent skill

The repository includes a skill that teaches Claude Code, Codex and other agents how to work with inplace: how to start it, find a commented element by its `data-id`, keep the ids intact, and check totals and charts after you change a number. Install it with the [skills CLI](https://skills.sh):

```bash
npx skills add jonasjancarik/inplace
```

After that, you can just ask the agent to open a document in inplace, and comments you leave on the page will be handled the right way.

## What you can and can't edit on the page

You can change the text of any paragraph, heading, list item, table cell, caption or text box, including bold, italics and links already in it. Enter leaves the block (Shift+Enter adds a line break), and pasted text arrives as plain text so it doesn't bring stray formatting along.

Everything structural is the agent's job: adding or removing paragraphs, rows and sections, changing styles or layout, and anything inside SVG charts. Tables, rows, lists, figures and charts can't be typed into as a whole, but they have ids too, so you can comment on them.

To keep part of a document out of reach on the page, for example figures that are calculated from data, add `data-locked` to the element. It can still be commented on.

## What inplace changes in your file

The first time the page is opened, inplace adds a `data-id` attribute to each block and container that doesn't have one yet:

```html
<p data-id="p-3">Raised beds are shared by floor.</p>
<table data-id="table-1">…</table>
```

The ids don't affect how the page looks or prints. Existing ids are never changed, and new elements get one the next time the page is opened. If the document is under version control, commit this change on its own so later diffs stay readable. Use `--no-write-ids` if the file mustn't be changed this way; blocks without an id then can't be edited.

Apart from the ids, the file only changes when you type into a block, and then only inside that block.

## Options

```text
inplace <file.html> [--port 8765] [--host 0.0.0.0] [--no-write-ids]
```

| Option | Default | |
| --- | --- | --- |
| `--port` | `8765` | Port to listen on. |
| `--host` | `0.0.0.0` | Address to listen on. The default makes the page reachable from other devices on your network, such as a tablet; use `127.0.0.1` to keep it on this computer. |
| `--no-write-ids` | off | Don't add `data-id` attributes to the file. |

Images, stylesheets and other files next to the document are served too, so relative links keep working.

## How it works

inplace is a small Node.js server with one dependency, [parse5](https://github.com/inikulin/parse5), the HTML parser that follows the same rules as browsers.

When you open the page, the server reads the file, adds any missing ids, and injects a short script before `</body>`. The script makes the text blocks editable and sends each change back as "block `p-3` used to contain X, now contains Y". The server finds `p-3` in the current file, checks it still contains X, and replaces just its contents. If it no longer contains X, because the agent changed it in the meantime, the save is refused.

The server also watches the file. When it changes on disk, every open page saves anything still pending and reloads, keeping your scroll position and the block you were in.

## Limitations

- It's built for one document and a small number of people at a time, on your own computer. There's no login, so don't run it on a network you don't trust.
- You can only change text on the page. New blocks, layout and styling go through the agent.
- Nothing recalculates by itself. If you change a number that feeds a total or a chart, the agent has to update those (the skill tells it to).
- Each save re-reads the whole file, so very large documents respond a little more slowly.

## Development

```bash
npm install
npm test
```

`npm link` puts your local checkout on the PATH as `inplace`. To use the skill from a checkout, link it into your agent's skills folder, e.g. `ln -s "$PWD/skills/inplace" ~/.claude/skills/inplace`.

## License

MIT
