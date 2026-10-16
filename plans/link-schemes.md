# Safe link addresses

## Problem

The link field in the formatting toolbar accepts any address. `endLink` in `static/editor.js` adds `https://` (or `mailto:`) when nothing that looks like a scheme is typed, but anything that does look like one is kept, so `javascript:alert(1)` or `data:text/html,…` goes into the file as an `<a href>`. The server doesn't check either: `saveBlock` in `src/server.ts` writes whatever inner HTML the page sends.

Since the user is writing their own document, the risk is small in a single-user setup. It matters more when the page is shared on the network (`--host 0.0.0.0`), where anyone on the network can type into it, and in documents that are later published or sent on.

## Change

1. **On the page.** Replace the scheme regex in `endLink` with a small `normalizeHref` like the one in human-review's `src/editing.js`:
   - trim it and strip control characters;
   - keep `#…`, `/…`, `./…`, `../…` and `?…` as they are;
   - a bare domain (`example.com`, `localhost:3000/x`) gets `https://`, and an address containing `@` without a scheme gets `mailto:`;
   - only allow `http:`, `https:`, `mailto:` and `tel:`, checked by parsing with `new URL(candidate, "https://relative.invalid")`;
   - for anything else, return an empty string and show "Links can start with http, https, mailto or tel" in the status pill, leaving the selection as it was.
2. **On the server.** In the save path (`Document.saveBlock`, and `insertBlock` for split content), refuse new `href` values whose scheme isn't on that list, with a 400 and the same message. Look only at `href`s that weren't already in the old inner HTML, so documents that already contain such links can still be edited around them. parse5 is already a dependency, so parse the fragment rather than using a regex.

## Tests

- Unit-test the server check in `test/htmldoc.test.ts` or a new `test/links.test.ts`: `javascript:`, `JaVaScRiPt:`, a leading-space variant and `data:` are refused, the allowed schemes and relative links pass, and an existing `javascript:` link in the old HTML doesn't block an unrelated edit.
- In the e2e suite, type `javascript:alert(1)` into the link field and check no link is created.

## Done when

No link with another scheme can be added from the page, existing documents still save, and both test suites pass.
