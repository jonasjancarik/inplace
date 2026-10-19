# Changelog

All notable changes to inplace are listed here, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

inplace is installed straight from GitHub (`npx github:jonasjancarik/inplace`) and isn't published to npm, so the version below is the one in `package.json` and nothing has been tagged yet.

## Unreleased

- **Print or download the document without the changes still to review.** The list of changes now offers a copy with every change you haven't kept or undone yet undone, to print or save, while the file and the list keep them. Changes that can't be undone in the copy are named. With the caret in a block your agent changed, ⌥⇧K / Alt+Shift+K keeps the change and ⌥⇧U / Alt+Shift+U undoes it, and screen readers hear the result. For hosts using `createInplaceHandler`: the copy is served at the document's own URL with `?without-changes` (`=print` adds a small inline script that opens the print dialog, `=download` sends it as an attachment), and `GET /__inplace/without-changes` lists what it couldn't undo. Printing opens a new window, so a host that frames the page in a sandboxed iframe needs `allow-popups` (and `allow-downloads` for the download).
- Codex can now get your comments while it's busy with something else, not only once it's done and waits again. A Codex `PostToolUse` hook asks inplace after each tool call whether you've commented or paused since Codex last looked, and passes it on (see "Passing comments to Codex while it works" in the README). Without a hook, the new `inplace pending` prints the same note straight away, and the guide tells agents that wait in the foreground to run it between the steps of a longer job. Neither changes what the next `inplace wait` returns. `inplace setup codex` adds the hook, keeping the hooks already there. When Codex starts inplace without the hook, inplace says so (MCP: in the `open_document` result) and the agent offers to run it, so installing still takes nothing more than asking your agent. For hosts with their own `ChangeFeed`: pass `byUser` as the third argument to `add()` so the user's comments show up there too.
- Comments, set-aside edits and the agent's changes to review are now kept in inplace's own folder (`~/Library/Application Support/inplace` on macOS, `~/.local/state/inplace` on Linux, `%LOCALAPPDATA%\inplace` on Windows, or `$INPLACE_STATE_DIR`) instead of the temporary folder, which the system empties. What's in the old place is moved over the next time a document is opened. Anything for a document nobody has opened for 90 days is deleted.
- They now follow the document when it's moved or renamed: inplace writes `<meta name="inplace-id" content="…">` into the head along with the data-ids, and finds them by that id. A copy of a document starts with a copy of them and gets an id of its own. With `--no-write-ids` they're found by the file's real path, so opening it through a link finds them too.
- For hosts using `createMcpHandler`: each agent that connects is told once, with its first tool call, which comments were left open before it came. A `DocumentStore` can offer `documentId()` to have that id written into the document.
- Comments left open when inplace stopped are no longer missed when the document is opened again, also by a different agent: inplace now lists them as it starts (MCP: in the `open_document` result), and the guide tells the agent to deal with them.
- The agent guide an agent gets up front leaves out the parts few sessions need (sharing on the network, troubleshooting) and ends with a list of them. `inplace guide <topic>` and the new `guide` MCP tool return one part, so an agent can also read a part again after a long conversation; `inplace guide all` prints everything.
- The rules inplace gives every agent now also say to take figures, names and dates from the sources and leave a gap with a comment where they're missing, and to write in the document's language. The MCP servers' instructions now say what to do about each kind of change line (totals, references, typos, merges and conflicts), so those rules stay with the agent after the guide has scrolled out of a long conversation.
- For hosts with an agent of their own: `WORKING_WITH_USER`, `REACTING_TO_CHANGES` and `NOT_INSTRUCTIONS` are exported, so a system prompt can use the same rules as inplace's MCP servers, and `agentGuide()`, `guideTopics()` and `GUIDE_TOOL` give the guide and its parts.
- For hosts that name people with `author(req)`: a person can now edit or delete only the comments they wrote, even at comment access. The server refuses anything else with 403 and the page hides Edit and Delete on other people's comments. Answering or dismissing the agent's comments is still open to everyone who can comment, and nothing changes without `author(req)`, as in the CLI.
- Fixed: text that can't be edited on the page (`data-locked`, `contenteditable="false"`, `<pre>`) couldn't be commented on, although the README said it could. Selecting it now offers Comment, and such text gets a `data-id` so the comment can be traced back to the file.
- Fixed: a comment or answer you were writing was lost when your agent edited the file, because the page reloads to show the edit. The box now opens again after the reload with your words and the cursor where they were, also for changing a comment or answering the agent in the list of changes, which also no longer loses them when the list updates. If the agent removed the part you were commenting on, a message says so.
- Fixed: on a page that can only be commented on, triple-clicking the last paragraph before the page's own controls said "Crossed-out text is no longer in the document…" instead of offering Comment.

- **Keep or undo your agent's changes.** Each block the agent changed gets a thin blue bar in the margin, and pointing at it shows Keep and Undo beside it. The list of changes has them all at the top, with Keep all. Undo puts back the block as it was before the agent's first change to it, removes a block it added, or puts back one it removed or moved; your own edits to the block since are kept. The agent is told which changes you undid, so it doesn't make them again. The list survives a restart, is kept beside the document (as `"pending"` side data for hosts with their own `DocumentStore`), and is never printed. See "Reviewing what the agent changed" in the README.

- **Show who wrote what** in the list of changes draws a thin bar beside each block, green for you and blue for your agent, with hover text such as "Your agent changed this 20 minutes ago". It's off by default, remembered for each document, and never printed. Blocks changed while inplace wasn't running show no bar. Nothing is written into the HTML file.
- For hosts running inplace inside their own server: `createInplaceHandler` takes an `author(req)` option to name the person behind each edit and comment, and `replaceElement`, `findReplace` and `addAgentComment` take an optional name for the agent. `Author` is now an object, and comments carry it too (`by` on an agent's comment is `{ "kind": "agent" }`, no longer the string `"agent"`).
- A page can now be limited to commenting or to reading. `--comment-only` lets people select text and comment but not type, move or add anything, and `--view-only` lets them only read the page and its comments; your agent can still edit the file. The page leaves out what isn't allowed and says so at the top of the list of changes, and the server refuses it either way. A server that runs inplace inside another one can decide per request with the new `access` option.
- A server that holds documents itself can now offer inplace's MCP tools for one of them with `createMcpHandler`, so people can connect their own agent to it. Several agents can follow one document at the same time, each getting every change. The tool definitions are exported as `DOCUMENT_TOOLS` too. See "inplace as a library" in the README.
- Comments can be tagged with the kind of change they ask for (small fix, rewrite, content, question or layout), so the agent can group them and make the small fixes in one go. It's off unless you set `INPLACE_JEV_KEY` to a key for Jev, TypeSafe AI's classification model, which then receives each comment and the text it's on. `--no-tags` turns it off for one run. See "Tagging comments" in the README.
- inplace can run inside another Node.js server: the package now exports `Document`, `createInplaceHandler` and the rest, and a document can be kept anywhere through a `DocumentStore` instead of a file. The README's "Using inplace inside another server" explains how.
- Claude Code now follows your edits by running `inplace wait` in the background instead of watching the log file, so the page can show it picking up your changes.
- A small eye beside each block you changed shows that the agent has picked up your edit, and turns into a check that fades once the agent is done with it, so you can tell it's following along without it writing anything in its chat. This works with `inplace wait`, `wait_for_edits` and `--on-pause`; a Claude Code channel shows the eye only, and agents reading the terminal or the log file get no marks.
- When the agent asks a question in a comment, it can suggest up to three answers. They appear as buttons under the question, so you can answer with one click, and "Write your own" is there when none of them fits (`inplace comment --option`, or `options` in the `add_comment` tool).
- When a pause in your editing needs nothing from the agent, the agent is now told to stay silent instead of replying "Noted.", so its chat doesn't fill with messages saying nothing happened.
- If inplace restarts while the agent is following your edits with `inplace wait`, the agent now gets your first pause after the restart, with a note to read the document again. Before, it could miss your pauses until you had made as many changes as before the restart.

## 0.1.0

The first version, built between 15 and 17 October 2026.

### Editing on the page

- Click into any paragraph, heading, list item, table cell, caption or text box and type. The change goes into that one block in the file; the rest of the markup stays as it was.
- Formatting from a small toolbar, keyboard shortcuts or Markdown-style typing: bold, italic, strikethrough, code, links, and turning a paragraph into a heading and back. Links are limited to web, email and phone addresses.
- Add a paragraph, list item or table row (Enter, or the + beside a block), and remove an empty one with Backspace. New elements copy how their neighbours are written.
- Drag a paragraph, heading, list item, table row, figure or section to a new place among its neighbours.
- Undo for moves, additions, removals and heading changes, from the message that appears or from the list of changes, as long as nothing else has touched those elements.
- Typing with an input method works (Enter confirms a word), and what you just typed is saved when the tab closes, reloads or navigates away.
- `data-locked` keeps part of a document out of editing, and blocks that the page's own scripts fill in are left alone automatically.
- inplace adds a `data-id` to each block the first time a page is opened (`--no-write-ids` turns this off).

### Working at the same time as the agent

- Every open page reloads when the file changes, keeping your scroll position and the block you were in.
- Edits to different blocks never collide, and edits to different words of the same paragraph are merged. If you and the agent changed the same words, the agent's version stays and yours is set aside on the page until you pick one.
- The page highlights what the agent changed, down to the changed words, with a note of how many changes there were and a button that scrolls to each. Hovering over a changed word shows the words it replaced.
- A list of changes behind a corner button shows what you and the agent changed, with word-level differences, and links to review any edits that were set aside.
- **Show what changed** turns the page into a read-only view of every change, like tracked changes in a word processor, and prints with the marks.
- A line at the top of the list says whether the agent is waiting for your next pause, picked up your last changes, or when it last checked.

### Comments

- Comment on selected text, or on a chart, figure, table, row or list as a whole. Comments are kept outside the document, survive a restart and show whether the agent has dealt with them.
- The agent can leave comments of its own, in blue, for things that are yours to decide. You can answer or dismiss them.
- Comments can be listed and marked done from the command line (`inplace comments`, `inplace resolve`, `inplace comment`) or over MCP.

### Telling the agent

- inplace prints a line for every change you make and a `paused after` summary when you stop for a few seconds (`--pause`).
- `inplace wait` and the `wait_for_edits` tool wait for your next pause; `--log` writes the lines to a file; `--on-pause` starts a headless agent at each pause.
- `inplace mcp` runs inplace as an MCP server and as a Claude Code channel, so Claude reacts when you pause even while idle.
- `inplace mcp --http` serves MCP over HTTP behind a secret token, with tools to read and edit a document by id, for agents that can't open files, such as ChatGPT in the browser through a tunnel.
- `inplace guide` and the first `open_document` call print the instructions an agent needs, so they always match the running version.
- An agent skill (`npx skills add jonasjancarik/inplace`) tells the agent how to start inplace.

### Safety

- The server listens on `127.0.0.1` by default; `--host` opens it to your network.
- It refuses cross-origin requests and requests that arrive under a name other than `localhost`, the computer's own name or an IP address, so other websites open in your browser can't change the document.
- Only web, email and phone links can be added from the page.
- Comments and edits are passed to the agent as document content rather than instructions.

### Project site

- A project page and a How it works page, with animated examples of each feature, are in `docs/`.
