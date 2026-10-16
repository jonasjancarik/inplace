# Is the agent listening?

## Problem

The page shows the user's edits being saved and the agent's changes arriving, but never whether an agent is currently picking up the user's edits. A user who changes an amount and waits for the total to be fixed can't tell whether nothing is happening because the agent is thinking, or because nothing is listening: the agent's turn ended, the Monitor watch expired after 30 minutes, the channel isn't loaded, or the agent was never told to watch.

human-review shows one of three states under its Send button ("listening", "working", "not listening") and its design notes call this "status tells the truth". inplace can't know as much, since agents read its output in several ways, but it can say what it does know.

## What the server can know

- **Channel:** in `inplace mcp`, whether the client declared the `claude/channel` capability and whether a notification was sent without error. That says the session is attached, not that it's awake.
- **Pulls:** when `get_edits`, `get_comments`, `read_document` or the HTTP equivalents were last called.
- **Waits:** whether an `inplace wait` or `wait_for_edits` call ([the wait plan](wait-for-pause.md)) is open right now. This is the strongest signal: something is blocked waiting for the next pause.
- **Agent writes:** when the file last changed from outside (`Document.refresh` already attributes these to the agent).
- **`--on-pause`:** whether the command is running (`PauseCommand.running`).

Stdout and `--log` readers (Monitor, `tail -F`) can't be seen at all. Don't guess about them.

## Change

1. Track those signals in one small object on the server (time of last pull, open waits count, channel attached, on-pause running, last agent write), and send a summary to pages as a new `agent` event on `/__inplace/events` whenever it changes, and at least once a minute so "minutes ago" stays fresh.
2. Turn the summary into one short line in the corner list of changes, at the top, worded from what the user sees:
   - "Your agent is waiting for your next pause." (a wait is open, or the channel is attached and a notification succeeded recently)
   - "Your agent is working on your last changes." (a pause was delivered to a wait or channel and the agent hasn't written or waited again since; also while `--on-pause` runs)
   - "Your agent last checked your changes 12 minutes ago." (only pulls)
   - "No agent has checked your changes yet. Ask your agent to pick up your edits." (nothing at all)
   For stdout and log readers we know nothing about, the last two lines are honest without being wrong: say "checked", never "isn't listening".
3. Optionally show a small dot on the corner button when there are edits the agent hasn't picked up (edits newer than the last pull, wait or channel delivery), so the user doesn't need to open the list.
4. Mention the line in the README's "How the agent finds out about your edits" section.

## Tests

- Unit tests for turning the signals into the state, including the "only stdout" case, which must not claim anything.
- An integration test: open a wait, check the `agent` event says waiting; trigger a pause, check it says working; write the file, check it changes again.
- e2e: the line shows in the list and updates on the event.

## Done when

The page says truthfully what inplace knows about the agent, never claims a reader it can't see is missing, and the suites pass.
