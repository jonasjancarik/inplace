# Enter with an input method

## Problem

When you type Japanese, Chinese or Korean, the operating system's input method builds a character or word as you type, and Enter confirms it. The browser still sends that Enter to the page as a `keydown`. inplace's handler in `static/editor.js` (the `keydown` listener next to `schedule`) treats every Enter without Shift as "end this block": it calls `splitBlock(el)` for paragraphs, headings and list items, and `el.blur()` for table cells and captions. So confirming a word splits the paragraph in two, or throws the user out of the cell.

The same check is missing for the link field in the toolbar (`linkInput`, which submits a form on Enter) and for the Escape handling, which can cancel a composition.

## Change

At the top of the `keydown` handler, return straight away while a composition is in progress:

```js
if (e.isComposing || e.keyCode === 229) return;
```

`keyCode === 229` covers Safari, which fires the confirming `keydown` after `compositionend`, so `isComposing` is already false. human-review uses the same test (`isImeCommitEnter` in its `src/sdk.js`).

Add the same guard to `linkInput`'s `keydown` handler. The form's `submit` comes from Enter too, so it's simplest to guard Enter in `keydown` and call `endLink(true)` there instead of relying on the implicit submit.

Markdown shortcuts (`markdown(el, e.data)` on `input`) run on `insertText`. Check that they don't fire on `insertCompositionText`; today they're limited to `insertText`, which is right, but add a test so it stays that way.

## Tests

In `e2e/editor.spec.ts`, Playwright can't drive a real input method, but it can dispatch the events. Dispatch `compositionstart`, then a `keydown` for Enter with `isComposing: true` (and one with `keyCode: 229`), then `compositionend`, and check the paragraph wasn't split and no `insert` request was sent. Keep the existing Enter test as the control.

## Done when

Enter during a composition does nothing in a block or in the link field, ordinary Enter still splits or leaves the block, and the e2e suite passes.
