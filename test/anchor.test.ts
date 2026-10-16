import assert from "node:assert/strict";
import { test } from "node:test";

import { buildContext, findQuote } from "../src/anchor.js";

const text = "The raised beds are shared. Each floor gets two raised beds near the stairs.";

test("captures the quote with the text around it", () => {
  const start = text.indexOf("shared");
  assert.deepEqual(buildContext(text, start, start + 6, 9), { prefix: "beds are ", quote: "shared", suffix: ". Each fl" });
  assert.deepEqual(buildContext(text, 0, 3, 9), { prefix: "", quote: "The", suffix: " raised b" });
});

test("finds a quote that appears once", () => {
  const ctx = buildContext(text, text.indexOf("shared"), text.indexOf("shared") + 6);
  assert.deepEqual(findQuote("Now: " + text, ctx), { start: 5 + text.indexOf("shared"), end: 5 + text.indexOf("shared") + 6, exact: true });
});

test("uses the text around a quote that appears twice to pick the right one", () => {
  const second = text.lastIndexOf("raised beds");
  const ctx = buildContext(text, second, second + 11);
  const found = findQuote(text, ctx)!;
  assert.equal(found.start, second);
  assert.ok(found.exact);
  const first = buildContext(text, 4, 15);
  assert.equal(findQuote(text, first)!.start, 4);
});

test("finds a quote whose whitespace changed", () => {
  const ctx = buildContext(text, text.indexOf("Each"), text.indexOf("stairs") + 6);
  const reflowed = text.replace("two raised", "two\n    raised");
  const found = findQuote(reflowed, ctx)!;
  assert.equal(reflowed.slice(found.start, found.end), "Each floor gets two\n    raised beds near the stairs");
  assert.equal(found.exact, false);
});

test("returns null when the quote is gone", () => {
  const ctx = buildContext(text, text.indexOf("shared"), text.indexOf("shared") + 6);
  assert.equal(findQuote(text.replace("shared", "private"), ctx), null);
  assert.equal(findQuote(text, { quote: "", prefix: "", suffix: "" }), null);
});
