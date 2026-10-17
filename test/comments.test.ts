import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CommentNotFound, CommentStore, NotTheirs } from "../src/comments.js";
import { Document } from "../src/server.js";

const strip = (line: string) => line.replace(/^\d\d:\d\d:\d\d /, "");

test("adds, edits, resolves and deletes comments, with one change line each", () => {
  const dir = mkdtempSync(join(tmpdir(), "inplace-comments-"));
  const lines: [string, boolean][] = [];
  const store = new CommentStore(join(dir, "comments.json"), (line, byUser) => lines.push([strip(line), byUser]));
  const first = store.add({ id: "p-7", text: "Say how many beds\neach floor gets.", quote: "raised beds are shared", prefix: "The ", suffix: "." });
  const second = store.add({ id: "figure-2", text: "  The bars should be in the same order as the table. " });
  assert.equal(first.n, 1);
  assert.equal(second.n, 2);
  assert.equal(second.quote, undefined);
  assert.equal(second.text, "The bars should be in the same order as the table.");

  store.edit(1, "Say how many beds each floor gets, and who decides.");
  store.resolve(1, "Added: two beds per floor, chosen by lot.");
  store.delete(2);
  assert.throws(() => store.delete(2), CommentNotFound);
  assert.throws(() => store.add({ id: "p-1", text: "  " }), /empty/);

  assert.deepEqual(lines, [
    ['comment #1 on p-7 at "raised beds are shared": "Say how many beds each floor gets."', true],
    ['comment #2 on figure-2: "The bars should be in the same order as the table."', true],
    ['comment #1 edited: "Say how many beds each floor gets, and who decides."', true],
    ['comment #1 marked done by the agent: "Added: two beds per floor, chosen by lot."', false],
    ["comment #2 deleted", true],
  ]);
  assert.deepEqual(store.list(false), []);
  assert.equal(store.list()[0].status, "done");
  assert.equal(store.list()[0].reply, "Added: two beds per floor, chosen by lot.");
});

test("long comments are clipped in the change line but kept whole", () => {
  const dir = mkdtempSync(join(tmpdir(), "inplace-comments-"));
  const lines: string[] = [];
  const store = new CommentStore(join(dir, "comments.json"), (line) => lines.push(line));
  const text = "word ".repeat(200).trim();
  store.add({ id: "p-1", text });
  assert.ok(lines[0].length < 600);
  assert.match(lines[0], /…"$/);
  assert.equal(store.get(1).text, text);
});

test("comments survive a restart, and numbers are never reused", () => {
  const dir = mkdtempSync(join(tmpdir(), "inplace-comments-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, '<html><body><p data-id="p-1">Hello</p></body></html>');
  const doc = new Document(path, true, () => {}, dir);
  doc.comments.add({ id: "p-1", text: "One" });
  doc.comments.add({ id: "p-1", text: "Two" });
  doc.comments.resolve(1);
  doc.comments.delete(2);
  assert.equal(doc.comments.clearDone(), 1);
  doc.comments.add({ id: "p-1", text: "Three" });

  const again = new Document(path, true, () => {}, dir);
  assert.deepEqual(again.comments.list().map((c) => [c.n, c.text]), [[3, "Three"]]);
  assert.equal(again.comments.add({ id: "p-1", text: "Four" }).n, 4);
});

test("the agent's comments are answered or dismissed by the user, never edited or deleted", () => {
  const dir = mkdtempSync(join(tmpdir(), "inplace-comments-"));
  const lines: [string, boolean][] = [];
  const store = new CommentStore(join(dir, "comments.json"), (line, byUser) => lines.push([strip(line), byUser]));
  store.add({ id: "td-4", text: "results.csv has 1,240.", quote: "1,420", prefix: "", suffix: "", by: "agent" });
  store.add({ id: "p-2", text: "This contradicts section 2.", by: "agent" });
  store.add({ id: "p-3", text: "Shorter, please." });

  assert.throws(() => store.edit(1, "Something else"), NotTheirs);
  assert.throws(() => store.delete(1), NotTheirs);
  assert.throws(() => store.answer(3, "Yes"), NotTheirs);
  store.answer(1, " Yes, and fix the total. ");
  store.dismiss(2);
  assert.throws(() => store.answer(2, "Actually yes"), NotTheirs);
  store.resolve(1, "Corrected both.");

  assert.deepEqual(lines, [
    ['comment #1 by the agent on td-4 at "1,420": "results.csv has 1,240."', false],
    ['comment #2 by the agent on p-2: "This contradicts section 2."', false],
    ['comment #3 on p-3: "Shorter, please."', true],
    ['comment #1 answered by the user: "Yes, and fix the total."', true],
    ["comment #2 dismissed by the user", true],
    ['comment #1 marked done by the agent: "Corrected both."', false],
  ]);
  assert.deepEqual(store.list().map((c) => [c.n, c.by, c.answer, c.dismissed, c.status]), [
    [1, "agent", "Yes, and fix the total.", undefined, "done"],
    [2, "agent", undefined, true, "done"],
    [3, undefined, undefined, undefined, "open"],
  ]);
});
