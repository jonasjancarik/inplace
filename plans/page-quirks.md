# Small fixes for unusual pages

Two small problems with pages that do things a plain document doesn't. Each can be done on its own.

## New links and lists can be invisible

Many generated pages include a CSS reset, such as Tailwind's preflight, that makes links look like plain text (`a { color: inherit; text-decoration: inherit }`) and removes list bullets and indentation. A link the user adds with ⌘K, or a list item they add, then looks as if nothing happened.

human-review checks the computed style after creating one and fills in only what's missing (`linkStyleFixup` and `listStyleFixup` in its `src/editing.js`). inplace should not write styles into the file, since its promise is that only the block's text changes. Instead, add the fix to the editor's own stylesheet (the `style` element at the top of `static/editor.js`), which only applies while the page is open in inplace:

- After the page loads, check one link inside an editable block, if there is one: if its colour equals its parent's and it has no underline, add a rule underlining `a` inside `[data-id][contenteditable=true]`. If there are no links yet, check after the first one is added.
- Lists can't be created on the page today, only items added to existing ones, which keep the page's own styling, so the list part isn't needed until inplace can create lists. Note it here for when it can.

Mention in the README section on formatting that links are underlined while editing when the page's own style doesn't set them apart.

Test with an e2e fixture that has the Tailwind-style reset: add a link and check it's underlined; with no reset, check nothing is added.

## "Show" can't reach blocks inside a closed tab or accordion

After the agent changes the file, the message at the bottom right offers "Show" for changes that are out of view, and the list of changes scrolls to a change when clicked (`goTo` in `static/editor.js`). If the changed block is inside a closed `<details>`, a hidden tab panel or a collapsed accordion, it has no size, and scrolling to it does nothing.

human-review opens the container before scrolling (`activate` in its `src/sdk.js`). Do the same in `goTo`:

1. If the block is inside a closed `<details>`, open it.
2. Otherwise walk up to the first ancestor that is `hidden` or has `display: none`. If it has an id and some element has `aria-controls` pointing to it, click that element (the usual pattern for tabs and accordions).
3. If the block still has no size, say "This change is in a part of the page that's hidden" in the status pill instead of doing nothing.

Also count such blocks as "out of view" when working out what "Show" steps through, so they aren't skipped.

Test with e2e fixtures for a closed `<details>` and an `aria-controls` tab panel: have the agent change a block inside each, click Show or the entry in the list, and check the block is visible and highlighted.
