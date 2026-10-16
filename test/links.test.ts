import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkNewLinks, hrefsIn, isSafeHref, UnsafeLink } from "../src/links.js";
import { Document } from "../src/server.js";

test("only http, https, mailto, tel and relative links are safe", () => {
  for (const href of ["https://example.com", "http://x", "mailto:a@b.cz", "tel:+420123", "#top", "/a", "./a", "../a", "?q=1", ""]) {
    assert.ok(isSafeHref(href), href);
  }
  for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "\u0001javascript:x",
    "java\tscript:x", "data:text/html,<b>hi</b>", "vbscript:x", "ftp://x"]) {
    assert.ok(!isSafeHref(href), href);
  }
});

test("hrefs are read as the browser reads them, entities decoded", () => {
  assert.deepEqual(hrefsIn('<a href="&#106;avascript:x">a</a> <b><a href=/b>b</a></b>'), ["javascript:x", "/b"]);
  assert.ok(!isSafeHref(hrefsIn('<a href="&#106;avascript:x">a</a>')[0]));
});

test("a new unsafe link is refused, an existing one doesn't block other edits", () => {
  assert.throws(() => checkNewLinks("Hello", 'Hello <a href="javascript:alert(1)">x</a>'), UnsafeLink);
  assert.throws(() => checkNewLinks("Hello", 'Hello <a href=" data:text/html,x">x</a>'), UnsafeLink);
  checkNewLinks("Hello", 'Hello <a href="https://example.com">x</a> <a href="#top">y</a>');
  const old = 'See <a href="javascript:void(0)">this</a>.';
  checkNewLinks(old, 'See <a href="javascript:void(0)">this</a> and more.');
});

test("saving or splitting a block with a new javascript: link is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "inplace-links-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, '<html><body><p data-id="p-1">Hello</p></body></html>');
  const doc = new Document(path, true, () => {}, dir);
  const before = readFileSync(path, "utf8");
  assert.throws(() => doc.saveBlock("p-1", "Hello", '<a href="javascript:alert(1)">Hello</a>'), UnsafeLink);
  assert.throws(() => doc.insertBlock("p-1", "after", "p", '<a href="javascript:alert(1)">x</a>'), UnsafeLink);
  assert.throws(() => doc.insertBlock("p-1", "after", "p", "lo", { old: "Hello", new: '<a href="javascript:x">Hel</a>' }), UnsafeLink);
  assert.equal(readFileSync(path, "utf8"), before);
  doc.saveBlock("p-1", "Hello", '<a href="https://example.com">Hello</a>');
  assert.match(readFileSync(path, "utf8"), /href="https:\/\/example.com"/);
});
