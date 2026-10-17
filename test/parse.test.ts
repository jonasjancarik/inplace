import assert from "node:assert/strict";
import { test } from "node:test";

import { parse, patchBlock } from "../src/htmldoc.js";

const doc = (body: string) => `<!doctype html><html><head><title>t</title></head><body>\n${body}\n</body></html>`;

test("a remembered tree is never used for different text", () => {
  const a = doc(`<p data-id="p-1">One</p>`);
  const b = doc(`<p data-id="p-1">Two</p>`);
  assert.equal(parse(a), parse(a));
  assert.notEqual(parse(a), parse(b));
  assert.equal(patchBlock(a, "p-1", "One", "Uno"), doc(`<p data-id="p-1">Uno</p>`));
  assert.equal(patchBlock(b, "p-1", "Two", "Dos"), doc(`<p data-id="p-1">Dos</p>`));
});
