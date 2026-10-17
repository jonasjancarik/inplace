# Show beside each edit that the agent has seen it

## Problem

The agent guide now tells the agent to end its turn without writing anything when a pause in the user's editing needs nothing. That keeps the agent's chat free of "Noted." after every pause, but it leaves the user with no sign that the agent saw their edit at all. The one line at the top of the list of changes ([agent-status](../src/agent.ts)) says whether the agent picked up the last changes, but it sits behind the corner button, so the user has to go and look.

The idea: next to each block the user edited, show a small eye while the agent is looking at the pause that included it, then a checkmark that fades out once the agent is done with it. The user sees this where they're already looking, nothing pops up, and the agent doesn't have to write anything in its chat.

## What the server can tell, in each setup

This builds on the signals `AgentStatus` already tracks; it adds no new way of delivering pauses and nothing new for the agent to do. The page must keep to the rule `AgentStatus` follows: only show what was actually observed.

| Setup | Used by | Eye: the agent picked up the pause | Check: the agent is done with it |
| --- | --- | --- | --- |
| `inplace wait` loop, MCP `wait_for_edits` | Codex, Cursor and other agents that can run commands | The wait returned the pause (`waitEnded(true)`) | The agent started its next wait (`waitStarted` after the delivery) |
| `--on-pause` command | `claude -p`, `codex exec` | The command started | The command exited |
| Claude Code channel | Claude Code started with the development-channels flag | The event was sent (`sentToChannel`) | Not known |
| Monitor on the `--log` file | Claude Code, the usual setup | Not known | Not known |
| Terminal output, Codex heartbeat reading the log | Various | Not known | Not known |
| `get_edits` at the start of a turn | ChatGPT over MCP | Only when it checks | Not known |

So the full eye-then-check sequence works in the first two setups with nothing new from the agent. In the channel setup there's an eye but no check. In Claude Code's usual Monitor setup, and wherever the agent reads the terminal or the log file, the server sees nothing, so there are no markers and the line in the list of changes stays as it is today.

## Change

1. **Carry the element ids with each change line.** The server writes each line where it already knows which element changed. Keep that id with the line in the pause watcher and the change feed, so a delivered pause knows which blocks it covered. Don't parse ids back out of the line's text. Lines without an element, such as a removed row or a comment, add nothing (comments already have their own done state).
2. **Remember the state of the latest pauses on the server**: for each pause, its block ids and whether it has been picked up and finished, using the transitions in the table. Send it with the existing `agent` event on `/__inplace/events`, so a reload, a second tab or another person's browser shows the same thing. Keep only the last few pauses.
3. **Show the markers on the page**:
   - An eye beside each block of a pause that has been picked up but not finished. The 👀 emoji is the original idea; a small icon in the style of the page's other controls may sit better. Hovering or focusing it says "Your agent picked up this change."
   - When the pause is finished, the eye becomes a checkmark ("Your agent checked this change.") that fades out after a couple of seconds. If the agent changed the file meanwhile, the page reloads and the existing highlight shows what it did; the check still fades as usual.
   - A block the user edits again after its pause was handed over loses its marker until the next pause covers it.
   - Where only the eye is known (the channel), let the eye fade out after a few seconds without becoming a check. Never show a check without the finishing signal, and never turn a timeout into one.
   - Where nothing is known, show no markers.
4. **Keep the markers out of the document.** Put them in an overlay outside the block, marked `data-inplace-ui` like the drag handles and comment markers, and never inside the editable element: the saving code reads the block's HTML, so a marker inside it would end up in the user's file. Don't let a marker shift text or take focus, since the pause comes only 5 seconds after the last keystroke and the user may still be typing in that block. Hide markers when printing, and respect `prefers-reduced-motion` for the fade.
5. Describe the markers in the README next to the line about the agent in the list of changes, and in the agent guide only if an agent needs to know about them (it shouldn't: nothing changes for the agent).

## Not part of this plan

These came up and were set aside because they'd make the current setup less reliable or noisier:

- **Pushing pauses over a WebSocket for Claude Code's Monitor.** Monitor can read a WebSocket, but the server uses Server-Sent Events, so this would be a new kind of connection for one client. When the socket closes, on a restart or when the Monitor expires after 30 minutes, pauses in between would be lost unless it were rebuilt with the feed's numbering. `tail -F` on the log file survives restarts and is the sturdiest part of the current setup.
- **An `inplace watch` command for the Monitor**, looping over `inplace wait`. It would start the next wait right after printing a pause, which `AgentStatus` reads as the agent being done, so checkmarks would appear before the agent had even woken up. Telling those waits apart would fix that, but it would still only give the eye, in exchange for replacing `tail -F`.
- **An `inplace ack` command** the agent runs when a pause needs nothing. It turns the "Noted." reply into a tool call, which is still a line in the agent's chat, and agents that forget it would leave eyes hanging.
- **A Claude Code hook that runs when the agent ends its turn** and tells inplace it's done. This could give the check in the Monitor and channel setups without the agent doing anything, but it needs a plugin or a change to the user's settings rather than the skill inplace has now. Worth another look if inplace ever ships as a plugin.

## Tests

- Unit tests for the per-pause state: picked up, then finished, in the wait and `--on-pause` setups; picked up only, in the channel setup; nothing at all with only stdout or a log file, which must produce no markers.
- An integration test: open a wait, make an edit and let it pause, check the `agent` event lists that block as picked up; start the next wait, check it's finished.
- e2e: the marker appears beside the edited block, sits outside the block's element, never reaches the saved file, and disappears when the block is edited again.

## Done when

An agent in the `inplace wait` loop or run by `--on-pause` shows an eye and then a fading check beside each edited block without writing anything in its chat; the channel shows the eye alone; setups the server can't see show nothing; the file is never touched by a marker; and the suites pass.
