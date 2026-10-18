# Optional comment tags from a fast classifier

When the user leaves several comments, the agent reads each one and decides for itself what kind of request it is: a small fix, a question, a rewrite. This plan adds an optional step where a fast, cheap classification model tags each comment as it comes in, so the agent can order and group its work at a glance. The first classifier to try is [Jev](https://arize.com/blog/typesafe-jev-llm-judge/) from TypeSafe AI. It doesn't write text: it answers typed questions with a choice and a calibrated confidence, and it's far faster and cheaper than asking a chat model.

It's an experiment. Try it on real documents for a while and keep it only if the tags change how the agent works through comments. If they don't, delete it.

## What it must not do

- **No edits.** The classifier only tags. The agent stays the only one who changes the file, apart from the user. Nothing takes a "small fix" route around the agent.
- **Nothing changes without a key.** Off by default. With no key configured, inplace makes no calls, shows no prompt and logs no warning, and behaves exactly as it does today. Nobody has to sign up for anything to use inplace.
- **Never in the way.** A comment's change line goes out the moment the comment is saved, as now. Classification runs afterwards in the background with a short timeout (under a second). If the API is slow, down or rejects the key, the comment simply has no tag. Log one line to stderr the first time a call fails in a session, not on every comment.
- **Hints, not rules.** The agent guide should present tags as a way to plan the order of work. Untagged comments are handled exactly as before, and the agent still reads every comment in full.

## How it fits

Comments live in `src/comments.ts` (`CommentStore.add` saves a comment and logs its change line). Comments already reach the agent in groups: the `paused after …` line sums up everything since the last pause (see "Reacting while you're idle" in `agent-guide.md`).

1. **Configuration.** Read the key from `INPLACE_JEV_KEY` (the CLI already reads `INPLACE_TOKEN` the same way in `src/cli.ts`). Add a `--no-tags` flag for turning it off in one session when the key is set globally. The MCP server (`src/mcp.ts`) reads the same variable. Hosts that embed inplace as a library (`src/index.ts`) pass a classifier function in, or none.
2. **A small classifier module**, for example `src/tags.ts`, with one function: comment text, quote and the element's text in, a tag and confidence out, or nothing. Keep Jev's API details inside it so another classifier can be swapped in later. Check Jev's current API docs before writing it; it was released in September 2026 and may still change.
3. **Tags.** Start with a short fixed list, worded for the agent: `small fix` (spelling, a word, punctuation), `rewrite` (tone, length, restructuring), `content` (add, remove or check facts and figures), `question` (the user is asking, not requesting a change), `layout` (charts, tables, styles). Store a tag only when confidence is high, at least 0.9; below that, leave the comment untagged. Save it on the comment as `tag`, so it survives restarts.
4. **Where the agent sees it.** In the `get_comments` / `inplace comments` JSON, and in the `paused after` summary, e.g. `comment #3 (small fix)`. Leave the immediate change line as it is, since the tag usually isn't ready yet.
5. **Privacy.** Turning it on sends each comment, its quote and the text of the element it's on to TypeSafe's servers. The README should say so plainly where it explains how to turn it on. Never send the whole document. Don't classify the agent's own comments or the user's answers to them.
6. **Agent guide.** A short paragraph under "Comments made on the page": comments may carry a tag; use tags to group similar requests and do the small fixes in one pass; ignore a tag that doesn't match what the comment says.

## Tests

- With no key, `CommentStore.add` makes no network call and the comment has no `tag`. This is the most important test.
- A classifier that times out or throws leaves the comment untagged, and the change line is still logged straight away.
- A tag below the confidence threshold isn't stored.
- The `paused after` summary shows tags when present and looks as it does now when they're absent.

Use a fake classifier in the tests; don't call the real API.

## Deciding whether to keep it

After a week or two of use, look at a few sessions with many comments. Keep the feature if the agent clearly grouped its work by tag, or finished rounds of comments faster. Remove it if the agent ignored the tags or the tags were often wrong. Before adding the dependency for good, do the usual health check: release activity, adoption, and whether the API is still stable.
