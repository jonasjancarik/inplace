import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BlockConflict } from "../src/htmldoc.js";
import { mergeInner } from "../src/merge.js";
import { Document } from "../src/server.js";

const BASE = "The roof is already used for drying laundry and storing <strong>old chairs</strong>.";

test("mergeInner combines edits to different words", () => {
  const mine = "The roof is already used for drying laundry and storing <strong>old chairs</strong>, mostly.";
  const theirs = "The flat roof is already used for drying laundry and storing <strong>old chairs</strong>.";
  assert.equal(mergeInner(BASE, mine, theirs),
    "The flat roof is already used for drying laundry and storing <strong>old chairs</strong>, mostly.");
});

test("mergeInner refuses when both sides change the same words", () => {
  const mine = "The roof is already used for hanging laundry and storing <strong>old chairs</strong>.";
  const theirs = "The roof is already used for drying clothes and storing <strong>old chairs</strong>.";
  assert.equal(mergeInner(BASE, mine, "The roof is already used for airing laundry and storing <strong>old chairs</strong>."), null);
  // Neighbouring words count as the same place.
  assert.equal(mergeInner(BASE, mine, theirs), null);
});

test("mergeInner accepts the same change made on both sides", () => {
  const both = BASE.replace("drying", "hanging");
  assert.equal(mergeInner(BASE, both, both), both);
});

test("mergeInner ignores how the file spells the markup and keeps the file's spelling", () => {
  const base = "Salt &amp; pepper,<br>to taste.";
  const theirs = "Salt &#38; pepper,<br/>\n  to taste.";
  const mine = "Salt &amp; pepper,<br>to taste, please.";
  assert.equal(mergeInner(base, mine, theirs), "Salt &#38; pepper,<br/>\n  to taste, please.");
});

test("mergeInner refuses when formatting and a word edit overlap", () => {
  const mine = BASE.replace("drying", "<em>drying</em>");
  const theirs = BASE.replace("drying", "hanging");
  assert.equal(mergeInner(BASE, mine, theirs), null);
});

function tempDoc(html: string) {
  const dir = mkdtempSync(join(tmpdir(), "inplace-merge-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, html);
  const lines: string[] = [];
  const doc = new Document(path, true, (line) => lines.push(line), join(dir, "stash"));
  doc.load();
  return { doc, path, lines, dir };
}

test("saveBlock merges an edit the file changed elsewhere in the same block", () => {
  const { doc, path, lines } = tempDoc(`<body><p>${BASE}</p></body>`);
  writeFileSync(path, readFileSync(path, "utf8").replace("The roof", "The flat roof"));
  const result = doc.saveBlock("p-1", BASE, BASE.replace("laundry", "laundry every day"));
  assert.equal(result.merged, true);
  assert.ok(readFileSync(path, "utf8").includes("The flat roof is already used for drying laundry every day"));
  assert.match(lines.at(-1)!, /edited p-1, merged with the file's newer version/);
  assert.equal(doc.stashCount, 0);
});

test("a save that can't be merged is set aside, survives a restart, and can be put back", () => {
  const { doc, path, lines, dir } = tempDoc(`<body><p>${BASE}</p></body>`);
  writeFileSync(path, readFileSync(path, "utf8").replace("drying laundry", "drying clothes"));
  const mine = BASE.replace("drying laundry", "hanging laundry");
  assert.throws(() => doc.saveBlock("p-1", BASE, mine), BlockConflict);
  assert.match(lines.at(-1)!, /conflict on p-1: .*stash #1.*hanging laundry.*drying clothes/);

  const again = new Document(path, true, () => {}, join(dir, "stash"));
  const [entry] = again.stashEntries();
  assert.equal(entry.mine, mine);
  assert.equal(entry.changed, false);
  assert.ok(entry.current!.includes("drying clothes"));

  again.resolveStash(entry.n, "mine");
  assert.ok(readFileSync(path, "utf8").includes("hanging laundry"));
  assert.equal(again.stashCount, 0);
});

test("a set-aside edit can be added below, or dismissed", () => {
  const { doc, path } = tempDoc(`<body>\n  <p>${BASE}</p>\n</body>`);
  for (const word of ["clothes", "towels"]) {
    writeFileSync(path, readFileSync(path, "utf8").replace(/drying \w+/, `drying ${word}`));
    assert.throws(() => doc.saveBlock("p-1", BASE, BASE.replace("drying laundry", `airing ${word}s`)), BlockConflict);
  }
  const [first, second] = doc.stashEntries();
  assert.equal(first.changed, true); // the file changed again after the first one was set aside
  doc.resolveStash(first.n, "below");
  assert.match(readFileSync(path, "utf8"), /drying towels.*<\/p>\n {2}<p data-id="p-2">.*airing clothess/s);
  doc.resolveStash(second.n, "discard");
  assert.equal(doc.stashCount, 0);
});
