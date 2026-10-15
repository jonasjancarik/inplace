import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assignIds, BlockConflict, BlockNotFound, canonical, editableBlocks, editableIds, parse, patchBlock,
} from "../src/htmldoc.js";

const DOC = `<!doctype html>
<html><head><style>p{color:red}</style></head>
<body>
<nav><a href="#x">Skip me</a></nav>
<section class="page">
<div class="body">
<h1>Title</h1>
<p class="lead">Hello <strong>world</strong> &amp; friends.</p>
<table><tbody><tr class="ft"><td><strong>Acme</strong><br>note</td><td>€12,400</td></tr></tbody></table>
<div class="pending"><strong>To do:</strong> finish.</div>
<figure><svg><text>chart</text></svg><figcaption>Caption</figcaption></figure>
<p data-locked>Generated total</p>
<ul><li>One</li><li><p>Nested</p></li></ul>
</div>
</section>
</body></html>
`;

const OLD_LEAD = "Hello <strong>world</strong> &amp; friends.";

test("picks innermost text blocks only", () => {
  const tags = editableBlocks(parse(DOC)).map((n) => n.tag);
  assert.deepEqual(tags, ["h1", "p", "td", "td", "div", "figcaption", "li", "p"]);
});

test("assignIds only touches start tags", () => {
  const { source: out, added } = assignIds(DOC);
  // 8 text blocks + section, div.body, table, tr, figure, svg, ul
  assert.equal(added, 15);
  assert.ok(out.includes('<p data-id="p-1" class="lead">'));
  assert.ok(out.includes('<div data-id="div-2" class="pending">'));
  assert.ok(out.includes('<table data-id="table-1">') && out.includes('<tr data-id="tr-1" class="ft">'));
  assert.ok(out.includes('<svg data-id="svg-1">'));
  assert.ok(out.includes("<nav>") && out.includes("<tbody>") && out.includes("<text>"));
  // Removing the inserted attributes gives back the original byte-for-byte.
  assert.equal(out.replace(/ data-id="[^"]+"/g, ""), DOC);
});

test("assignIds is stable and skips used ids", () => {
  const once = assignIds(DOC).source;
  const twice = assignIds(once);
  assert.equal(twice.added, 0);
  assert.equal(twice.source, once);
  // A new paragraph from the agent gets a fresh id, existing ones stay.
  const out = assignIds(once.replace("<h1", "<p>New one</p>\n<h1"));
  assert.equal(out.added, 1);
  assert.ok(out.source.includes('<p data-id="p-3">New one</p>'));
  assert.ok(out.source.includes('<p data-id="p-1" class="lead">'));
});

test("patchBlock replaces inner HTML only", () => {
  const src = assignIds(DOC).source;
  // Browser serialisation differs from the source (entities, quoting);
  // that must still count as "unchanged".
  const out = patchBlock(src, "p-1", OLD_LEAD, "Hi <strong>world</strong>.");
  assert.ok(out.includes('<p data-id="p-1" class="lead">Hi <strong>world</strong>.</p>'));
  assert.equal(out.replace("Hi <strong>world</strong>.", OLD_LEAD), src);
});

test("patchBlock detects a concurrent agent edit", () => {
  const src = assignIds(DOC).source;
  const agent = src.replace("Hello <strong>world</strong>", "Hello <strong>agent</strong>");
  assert.throws(() => patchBlock(agent, "p-1", OLD_LEAD, "mine"), BlockConflict);
});

test("patchBlock merges edits in different blocks", () => {
  const src = assignIds(DOC).source;
  const agent = src.replace(">Title<", ">New title<");
  const out = patchBlock(agent, "p-1", OLD_LEAD, "Mine");
  assert.ok(out.includes(">New title<") && out.includes(">Mine</p>"));
});

test("whitespace and nbsp are not changes", () => {
  assert.deepEqual(canonical("a\n  b&nbsp;c<br/>"), canonical("a b c<br>"));
});

test("unknown block", () => {
  assert.throws(() => patchBlock(DOC, "nope", "", "x"), BlockNotFound);
});

test("containers are anchors, not editable", () => {
  const src = assignIds(DOC).source;
  const ids = editableIds(src);
  assert.ok(ids.includes("p-1") && ids.includes("td-1"));
  for (const id of ["table-1", "tr-1", "figure-1", "svg-1", "div-1"]) assert.ok(!ids.includes(id), id);
  assert.throws(() => patchBlock(src, "table-1", "", "gone"), BlockNotFound);
});

test("implicitly closed paragraphs and list items are editable", () => {
  const src = assignIds("<body><p>One<p>Two\n<ul><li>A<li>B</ul></body>").source;
  assert.deepEqual(editableIds(src), ["p-1", "p-2", "li-1", "li-2"]);
  const out = patchBlock(src, "li-1", "A", "Alpha");
  assert.equal(out, '<body><p data-id="p-1">One<p data-id="p-2">Two\n<ul data-id="ul-1"><li data-id="li-1">Alpha<li data-id="li-2">B</ul></body>');
});
