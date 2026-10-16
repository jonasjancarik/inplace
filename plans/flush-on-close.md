# Save when the tab closes

## Problem

`static/editor.js` saves a block 600 ms after the last keystroke (`SAVE_DELAY`) and when the block loses focus. Closing the tab, reloading it or going back doesn't fire `focusout` reliably, and a pending `setTimeout` simply never runs. Whatever was typed in that last moment is lost, without any message, because the page is gone.

human-review handles this by flushing everything still waiting when the page is about to go away and sending it with a `fetch` that may outlive the page (`keepalive: true`).

## Change

1. Add a `pagehide` listener (more reliable than `beforeunload`, and it also fires for the back/forward cache). For every id in `timers` (the blocks with a pending save), run the same steps as `save(el)` up to the request: `clean(el)`, `tidySpaces`, and skip it if nothing changed.
2. Send each one with `fetch("/__inplace/save", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body })`. Don't use `navigator.sendBeacon`: it can't set `Content-Type: application/json`, which the server requires once the cross-site fix (branch `claude/zen-lamarr-0938fe`) is merged. Browsers cap the total size of `keepalive` bodies at 64 KB, which is plenty for one block; if a body is bigger, skip it rather than fail.
3. Don't wait for the reply or touch the page state. Responses can't be handled after the page is gone. A conflict still lands in the server's stash as usual, so the user finds it there next time.
4. The block the caret is in may have unsaved changes even without a pending timer (if the timer was just cleared by `save` and the request is still in flight, nothing more is needed). Only blocks with a pending timer need flushing.

Also treat `visibilitychange` to `hidden` as a cue to save pending blocks normally (the ordinary `save`, not `keepalive`). Mobile browsers often kill a hidden tab without firing `pagehide`.

## Tests

In `e2e/editor.spec.ts`, type into a paragraph and close the page (or navigate away) right away, within 600 ms. Read the file and check the text was saved. Add a second case with a reload instead of a close.

## Done when

Typing followed immediately by closing, reloading or navigating away keeps the text in the file, and the e2e suite passes.
