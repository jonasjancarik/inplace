import assert from "node:assert/strict";
import { test } from "node:test";

import { diffBlocks, History, plainText } from "../src/history.js";

const doc = (body: string) => `<!doctype html><html><body>${body}</body></html>`;
const BASE = doc(`
<h1 data-id="h1-1">Title</h1>
<p data-id="p-1">First paragraph.</p>
<p data-id="p-2">Second &amp; last.</p>
<table data-id="table-1"><tbody>
<tr data-id="tr-1"><td data-id="td-1">A</td><td data-id="td-2">1</td></tr>
<tr data-id="tr-2"><td data-id="td-3">B</td><td data-id="td-4">2</td></tr>
</tbody></table>`);

test("a changed paragraph is reported with its old and new text", () => {
  const after = BASE.replace("Second &amp; last.", "Second &amp; <b>final</b>.");
  assert.deepEqual(diffBlocks(BASE, after), [
    { id: "p-2", kind: "changed", tag: "p", before: "Second & last.", after: "Second & final." },
  ]);
});

test("a new row counts once, not once per cell, and its table isn't reported", () => {
  const after = BASE.replace("</tbody>", `<tr data-id="tr-3"><td data-id="td-5">C</td><td data-id="td-6">3</td></tr>\n</tbody>`);
  assert.deepEqual(diffBlocks(BASE, after), [{ id: "tr-3", kind: "added", tag: "tr", after: "C 3" }]);
});

test("removed blocks and changed tags are reported", () => {
  const after = BASE.replace(`<p data-id="p-1">First paragraph.</p>`, "")
    .replace(`<p data-id="p-2">Second &amp; last.</p>`, `<h2 data-id="p-2">Second &amp; last.</h2>`);
  assert.deepEqual(diffBlocks(BASE, after), [
    { id: "p-2", kind: "changed", tag: "h2", fromTag: "p", before: "Second & last.", after: "Second & last." },
    { id: "p-1", kind: "removed", tag: "p", before: "First paragraph.", place: { parent: "", prev: "h1-1", next: "p-2" } },
  ]);
});

test("a moved block is reported once, not its neighbours", () => {
  const p1 = `<p data-id="p-1">First paragraph.</p>`;
  const after = BASE.replace(p1 + "\n", "").replace(`<table`, p1 + "\n<table");
  assert.deepEqual(diffBlocks(BASE, after), [
    { id: "p-1", kind: "moved", tag: "p", after: "First paragraph.", place: { parent: "", prev: "h1-1", next: "p-2" } },
  ]);
});

test("a removed row remembers its neighbours in the table, not the table's neighbours", () => {
  const after = BASE.replace(/<tr data-id="tr-1">.*?<\/tr>\n/, "");
  assert.deepEqual(diffBlocks(BASE, after), [
    { id: "tr-1", kind: "removed", tag: "tr", before: "A 1", place: { parent: "table-1", next: "tr-2" } },
  ]);
});

test("a block moved and then removed keeps the place it had first", () => {
  const p1 = `<p data-id="p-1">First paragraph.</p>`;
  const moved = BASE.replace(p1 + "\n", "").replace(`<table`, p1 + "\n<table");
  const history = new History();
  history.add("you", diffBlocks(BASE, moved));
  history.add("you", diffBlocks(moved, moved.replace(p1, "")));
  assert.deepEqual(history.entries[0].changes, [
    { id: "p-1", kind: "removed", tag: "p", before: "First paragraph.", place: { parent: "", prev: "h1-1", next: "p-2" } },
  ]);
});

test("nothing is reported when only whitespace between blocks changes", () => {
  assert.deepEqual(diffBlocks(BASE, BASE.replace("</h1>\n", "</h1>\n\n\n")), []);
});

test("quick changes by the same author are combined into one entry", () => {
  const history = new History(30_000);
  const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, s));
  history.add("you", [{ id: "p-1", kind: "changed", tag: "p", before: "a", after: "ab" }], t(0));
  history.add("you", [{ id: "p-1", kind: "changed", tag: "p", before: "ab", after: "abc" }], t(5));
  history.add("agent", [{ id: "p-2", kind: "added", tag: "p", after: "x" }], t(6));
  history.add("agent", [{ id: "p-2", kind: "changed", tag: "p", before: "x", after: "xy" }], t(8));
  history.add("you", [{ id: "p-1", kind: "changed", tag: "p", before: "abc", after: "abcd" }], t(9));
  assert.deepEqual(history.entries.map((e) => [e.by, e.changes]), [
    ["you", [{ id: "p-1", kind: "changed", tag: "p", before: "a", after: "abc" }]],
    ["agent", [{ id: "p-2", kind: "added", tag: "p", after: "xy" }]],
    ["you", [{ id: "p-1", kind: "changed", tag: "p", before: "abc", after: "abcd" }]],
  ]);
});

test("a change that is undone within the same entry disappears", () => {
  const history = new History(30_000);
  history.add("you", [{ id: "p-1", kind: "changed", tag: "p", before: "a", after: "ab" }]);
  history.add("you", [{ id: "p-1", kind: "changed", tag: "p", before: "ab", after: "a" }]);
  assert.equal(history.entries.length, 0);
});

test("plain text decodes entities and drops tags", () => {
  assert.equal(plainText("Fish&nbsp;&amp; <i>chips</i><br>&#8364;5 &#x2014; ok"), "Fish & chips €5 — ok");
});
