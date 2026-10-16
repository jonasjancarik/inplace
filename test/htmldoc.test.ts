import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assignIds, blockHashes, BlockConflict, BlockNotFound, canonical, contentHash, editableBlocks, editableIds, insertBlock, movableIds, moveBlock,
  parse, patchBlock, removeBlock, retagBlock,
} from "../src/htmldoc.js";
import { describeEdit } from "../src/server.js";

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
  // 8 text blocks + section, div.body, table, tr, figure, svg, ul, li with a paragraph inside
  assert.equal(added, 16);
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

const LIST = `<body>
<ul>
  <li data-id="li-1">One</li>
  <li data-id="li-2">Two</li>
  <li data-id="li-3">Three</li>
</ul>
<p data-id="p-1">Para</p><p data-id="p-2">Inline</p>
</body>`;

test("moveBlock keeps each element on its own line", () => {
  assert.equal(
    moveBlock(LIST, "li-3", "li-1", "before"),
    LIST.replace("  <li data-id=\"li-1\">One</li>\n  <li data-id=\"li-2\">Two</li>\n  <li data-id=\"li-3\">Three</li>",
      "  <li data-id=\"li-3\">Three</li>\n  <li data-id=\"li-1\">One</li>\n  <li data-id=\"li-2\">Two</li>"),
  );
  const down = moveBlock(LIST, "li-1", "li-3", "after");
  assert.ok(down.includes("<ul>\n  <li data-id=\"li-2\">Two</li>\n  <li data-id=\"li-3\">Three</li>\n  <li data-id=\"li-1\">One</li>\n</ul>"));
  assert.ok(moveBlock(LIST, "p-2", "p-1", "before").includes('</ul>\n<p data-id="p-2">Inline</p>\n<p data-id="p-1">Para</p>\n</body>'));
  assert.ok(moveBlock(LIST, "p-1", "p-2", "after").includes('</ul>\n<p data-id="p-2">Inline</p><p data-id="p-1">Para</p>\n</body>'));
});

test("moveBlock only moves among siblings", () => {
  assert.throws(() => moveBlock(LIST, "li-1", "p-1", "before"), BlockConflict);
  assert.throws(() => moveBlock(LIST, "li-1", "nope", "before"), BlockNotFound);
});

test("movable elements exclude cells, captions and locked parts", () => {
  const src = assignIds(DOC).source;
  const ids = movableIds(src);
  assert.ok(ids.includes("li-1") && ids.includes("li-2") && ids.includes("p-1") && ids.includes("table-1"));
  for (const id of ["td-1", "td-2", "figcaption-1", "tr-1", "svg-1", "section-1"]) assert.ok(!ids.includes(id), id);
});

test("retagBlock turns a paragraph into a heading and back", () => {
  const src = '<body><p data-id="p-1" class="x">Hi <b>there</b></p></body>';
  const h2 = retagBlock(src, "p-1", "p", "h2");
  assert.equal(h2, '<body><h2 data-id="p-1" class="x">Hi <b>there</b></h2></body>');
  assert.equal(retagBlock(h2, "p-1", "h2", "p"), src);
  assert.throws(() => retagBlock(h2, "p-1", "p", "h3"), BlockConflict);
  assert.equal(retagBlock('<body><p data-id="p-1">A<p data-id="p-2">B</body>', "p-1", "p", "h1"),
    '<body><h1 data-id="p-1">A</h1><p data-id="p-2">B</body>');
});

test("describeEdit shows only the changed part", () => {
  const long = "The committee met on Tuesday and agreed that the garden would have ten raised beds, shared by floor, with a rota.";
  assert.equal(
    describeEdit(long, long.replace("ten", "twelve")),
    '"…agreed that the garden would have ten raised beds, shared by floor,…" → "…agreed that the garden would have twelve raised beds, shared by floor,…"',
  );
  assert.equal(describeEdit("Hi", "Hi <strong>there</strong>"), '"Hi" → "Hi <strong>there</strong>"');
});

const REPORT = `<body>
<div class="body">
  <h2 data-id="h2-1">Costs</h2>
  <p data-id="p-1" class="lead">Intro</p>
  <p data-id="p-2">Plain one</p>
  <p data-id="p-3">Plain two</p>
  <table data-id="table-1"><tbody>
    <tr data-id="tr-1"><td data-id="td-1">Beds</td><td data-id="td-2" class="num">€3,600</td></tr>
    <tr data-id="tr-2" class="total"><td data-id="td-3">Total</td><td data-id="td-4" class="num">€3,600</td></tr>
  </tbody></table>
</div>
</body>`;

test("insertBlock copies the usual pattern among siblings", () => {
  // After the lead paragraph, a new paragraph looks like the ordinary ones.
  const after = insertBlock(REPORT, "p-1", "after", "p");
  assert.equal(after.html, '<p data-id="p-4"></p>');
  assert.ok(after.source.includes('Intro</p>\n  <p data-id="p-4"></p>\n  <p data-id="p-2">'));
  // After a heading, Enter gives a paragraph, not another heading.
  assert.equal(insertBlock(REPORT, "h2-1", "after", "p").html, '<p data-id="p-4"></p>');
  // A new row copies an ordinary row's cells (and their classes), empty.
  const row = insertBlock(REPORT, "tr-1", "after", "tr");
  assert.equal(row.html, '<tr data-id="tr-3"><td data-id="td-5"></td><td data-id="td-6" class="num"></td></tr>');
  assert.ok(editableIds(row.source).includes("td-6"));
});

test("insertBlock splits a paragraph in one write", () => {
  const out = insertBlock(REPORT, "p-2", "after", "p", "one", { old: "Plain one", new: "Plain " });
  assert.ok(out.source.includes('<p data-id="p-2">Plain </p>\n  <p data-id="p-4">one</p>'));
  assert.throws(() => insertBlock(REPORT, "p-2", "after", "p", "x", { old: "stale", new: "Plain" }), BlockConflict);
  assert.throws(() => insertBlock(REPORT, "p-2", "after", "h1"), BlockNotFound);
});

test("removeBlock only removes empty elements", () => {
  const added = insertBlock(REPORT, "tr-1", "after", "tr");
  assert.equal(removeBlock(added.source, "tr-3"), REPORT);
  assert.equal(removeBlock(insertBlock(REPORT, "p-3", "after", "p").source, "p-4"), REPORT);
  assert.throws(() => removeBlock(REPORT, "p-2"), BlockConflict);
  assert.throws(() => removeBlock(REPORT, "td-1"), BlockNotFound);
});

test("blocks with buttons or form fields inside aren't editable", () => {
  const src = assignIds('<body><div class="cmd"><span>npm i</span><button>Copy</button></div><p>Text</p><label>Name <input></label></body>').source;
  assert.deepEqual(editableIds(src), ["p-1"]);
  assert.ok(src.includes('<div data-id="div-1" class="cmd">'), "still gets an id for comments");
});

test("block hashes match what a browser's innerHTML hashes to", () => {
  const source = `<!doctype html><body><p data-id="p-1">Tom &amp; Jerry&nbsp;&#169;
    <a href='x.html' title=a&quot;b>link</a><br/>next &lt;3 &gt; "quoted"</p><script>1</script></body>`;
  // How Chrome writes out the same paragraph's innerHTML.
  const browser = `Tom &amp; Jerry&nbsp;\u00a9\n    <a href="x.html" title="a&quot;b">link</a><br>next &lt;3 &gt; "quoted"`;
  assert.equal(blockHashes(source)!["p-1"], contentHash(browser));
  assert.notEqual(contentHash(browser), contentHash(browser.replace("Jerry", "Spike")));
});

test("block hashes are only sent for documents with scripts", () => {
  assert.equal(blockHashes('<body><p data-id="p-1">Hi</p></body>'), null);
  assert.ok(blockHashes('<body><p data-id="p-1">Hi</p><script src="x.js"></script></body>'));
  assert.ok(blockHashes('<body onload="go()"><p data-id="p-1">Hi</p></body>'));
});
