import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Document, UndoGone } from "../src/server.js";

const LIST = `<!doctype html><html><body>
<h1 data-id="h1-1">Plan</h1>
<ul data-id="ul-1">
  <li data-id="li-1">One</li>
  <li data-id="li-2">Two</li>
  <li data-id="li-3">Three</li>
  <li data-id="li-4">Four</li>
</ul>
<p data-id="p-1">Notes</p>
</body></html>
`;

function open(html = LIST) {
  const dir = mkdtempSync(join(tmpdir(), "inplace-undo-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, html);
  const lines: string[] = [];
  const doc = new Document(path, true, (line) => lines.push(line), dir);
  const read = () => readFileSync(path, "utf8");
  // An agent's edit: a write inplace didn't make.
  const agent = (from: string, to: string) => {
    const text = read();
    assert.ok(text.includes(from), `agent edit: ${from} not found`);
    writeFileSync(path, text.replace(from, to));
  };
  return { doc, read, agent, lines };
}

const order = (text: string) => [...text.matchAll(/<li data-id="(li-\d)"/g)].map((m) => m[1]);

test("undoing a move puts the file back exactly as it was", () => {
  const { doc, read, lines } = open();
  doc.moveBlock("li-1", "li-3", "after");
  assert.deepEqual(order(read()), ["li-2", "li-3", "li-1", "li-4"]);
  assert.deepEqual(doc.undoable(), [{ kind: "move", id: "li-1" }]);
  doc.undo("move", "li-1");
  assert.equal(read(), LIST);
  assert.match(lines.at(-1)!, /moved li-1 before li-2 \(inside ul-1\) \(undone\)$/);
  assert.deepEqual(doc.undoable(), []);
});

test("a move is undone next to its old neighbour after other changes to the file", () => {
  const { doc, read, agent } = open();
  doc.moveBlock("li-2", "li-4", "after");
  agent("Notes", "Notes from Monday");
  doc.undo("move", "li-2");
  assert.deepEqual(order(read()), ["li-1", "li-2", "li-3", "li-4"]);
  assert.match(read(), /Notes from Monday/);
  assert.equal(read(), LIST.replace("Notes", "Notes from Monday"));
});

test("when the old neighbour after it is gone, the one before it is used", () => {
  const { doc, read, agent } = open();
  doc.moveBlock("li-2", "li-4", "after");
  agent(`  <li data-id="li-3">Three</li>\n`, "");
  doc.undo("move", "li-2");
  assert.deepEqual(order(read()), ["li-1", "li-2", "li-4"]);
});

test("a move can't be undone once both old neighbours are gone", () => {
  const { doc, agent } = open();
  doc.moveBlock("li-2", "li-4", "after");
  agent(`  <li data-id="li-1">One</li>\n`, "");
  agent(`  <li data-id="li-3">Three</li>\n`, "");
  assert.deepEqual(doc.undoable(), []);
  assert.throws(() => doc.undo("move", "li-2"), (e: unknown) =>
    e instanceof UndoGone && e.message === "This can't be undone any more, because the elements around it have changed.");
});

test("an added element is removed again while it's still empty", () => {
  const { doc, read } = open();
  const { id } = doc.insertBlock("p-1", "after", "p", "");
  assert.deepEqual(doc.undoable(), [{ kind: "add", id }]);
  doc.undo("add", id);
  assert.equal(read(), LIST);

  const second = doc.insertBlock("p-1", "after", "p", "").id;
  doc.saveBlock(second, "", "Something");
  assert.deepEqual(doc.undoable(), []);
  assert.throws(() => doc.undo("add", second), /because it has text in it now/);
});

test("a removed element comes back where it was, also after other changes", () => {
  const html = LIST.replace("Three", "");
  const { doc, read, agent } = open(html);
  doc.removeBlock("li-3");
  agent("Notes", "Notes from Monday");
  doc.undo("remove", "li-3");
  assert.equal(read(), html.replace("Notes", "Notes from Monday"));
});

test("a heading change is undone by changing it back", () => {
  const { doc, read, agent } = open();
  doc.retagBlock("p-1", "p", "h2");
  agent("Plan", "The plan");
  assert.deepEqual(doc.undoable(), [{ kind: "retag", id: "p-1" }]);
  doc.undo("retag", "p-1");
  assert.equal(read(), LIST.replace("Plan", "The plan"));
});
