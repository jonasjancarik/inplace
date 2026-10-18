import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CantUndo } from "../src/pending.js";
import { Document } from "../src/server.js";

const DOC = `<!doctype html><html><body>
<h1 data-id="h1-1">Plan</h1>
<p data-id="p-1">The roof garden opens in May.</p>
<p data-id="p-2">Two beds stay open for anyone.</p>
<ul data-id="ul-1">
  <li data-id="li-1">One</li>
  <li data-id="li-2">Two</li>
  <li data-id="li-3">Three</li>
</ul>
<p data-id="p-3">Notes</p>
</body></html>
`;

function open(html = DOC) {
  const dir = mkdtempSync(join(tmpdir(), "inplace-pending-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, html);
  const lines: string[] = [];
  const make = () => new Document(path, true, (line) => lines.push(line), dir);
  const doc = make();
  const read = () => readFileSync(path, "utf8");
  // An agent's edit: a write inplace didn't make, picked up the next time inplace looks.
  const agent = (from: string | RegExp, to: string) => {
    const text = read();
    const next = text.replace(from, to);
    assert.notEqual(next, text, `agent edit: ${from} not found`);
    writeFileSync(path, next);
    doc.poll();
  };
  return { doc, read, agent, lines, make, path };
}

const pending = (doc: Document) => doc.pendingChanges().map((p) => `${p.kind} ${p.id}`);
const inner = (text: string, id: string) => new RegExp(`data-id="${id}">([^<]*)<`).exec(text)?.[1];

test("only the agent's changes are pending, and several writes to one block are one change", () => {
  const { doc, agent } = open();
  doc.saveBlock("p-3", "Notes", "Notes for May");
  assert.deepEqual(pending(doc), []);
  agent("opens in May", "opens in June");
  agent("opens in June", "opens in early June");
  assert.deepEqual(pending(doc), ["changed p-1"]);
  assert.equal(doc.pendingChanges()[0].before, "The roof garden opens in May.");
  doc.undoAgentChange("p-1");
  assert.equal(inner(doc.source(), "p-1"), "The roof garden opens in May.");
  assert.deepEqual(pending(doc), []);
});

test("a change the agent takes back itself isn't pending any more", () => {
  const { doc, agent } = open();
  agent("opens in May", "opens in June");
  agent("opens in June", "opens in May");
  assert.deepEqual(pending(doc), []);
});

test("a new list counts as one change, including what the agent changes inside it later", () => {
  const { doc, agent, read } = open();
  agent("<p data-id=\"p-3\">", '<ol data-id="ol-1">\n  <li data-id="li-9">A</li>\n  <li data-id="li-10">B</li>\n</ol>\n<p data-id="p-3">');
  agent(">B<", ">Bee<");
  assert.deepEqual(pending(doc), ["added ol-1"]);
  doc.undoAgentChange("ol-1");
  assert.equal(read(), DOC);
});

test("keeping a change only takes it off the list", () => {
  const { doc, agent, read } = open();
  agent("opens in May", "opens in June");
  agent("Two beds", "Three beds");
  const file = read();
  doc.keepAgentChange("p-1");
  assert.deepEqual(pending(doc), ["changed p-2"]);
  doc.keepAgentChange();
  assert.deepEqual(pending(doc), []);
  assert.equal(read(), file);
});

test("undoing a change after the user edited the block undoes only the agent's words", () => {
  const { doc, agent, lines } = open();
  agent("opens in May", "opens in June");
  doc.saveBlock("p-1", "The roof garden opens in June.", "The rooftop garden opens in June.");
  assert.deepEqual(pending(doc), ["changed p-1"], "the user's edit leaves it pending");
  doc.undoAgentChange("p-1", { id: "u1", name: "Jana" });
  assert.equal(inner(doc.source(), "p-1"), "The rooftop garden opens in May.");
  assert.match(lines.at(-1)!, /undid the agent's change to p-1 \(Jana\): "The rooftop garden opens in June\." → "The rooftop garden opens in May\."$/);
  // Written as the person who clicked, not as the agent.
  const last = doc.history.entries.at(-1)!;
  assert.deepEqual(last.by, { kind: "person", id: "u1", name: "Jana" });
});

test("an undo that clashes with a later edit to the same words is refused and stays pending", () => {
  const { doc, agent } = open();
  agent("opens in May", "opens in June");
  doc.saveBlock("p-1", "The roof garden opens in June.", "The roof garden opens in July.");
  assert.throws(() => doc.undoAgentChange("p-1"), CantUndo);
  assert.equal(inner(doc.source(), "p-1"), "The roof garden opens in July.");
  assert.deepEqual(pending(doc), ["changed p-1"]);
});

test("a changed tag goes back with the words", () => {
  const { doc, agent, read } = open();
  agent('<p data-id="p-3">Notes</p>', '<h2 data-id="p-3">Notes and plans</h2>');
  assert.deepEqual(pending(doc), ["changed p-3"]);
  doc.undoAgentChange("p-3");
  assert.equal(read(), DOC);
});

test("undoing an addition removes the block, unless it has been changed since", () => {
  const { doc, agent, read, lines } = open();
  agent('<p data-id="p-3">', '<p data-id="p-4">A new paragraph.</p>\n<p data-id="p-3">');
  agent('<p data-id="p-3">', '<p data-id="p-5">Another.</p>\n<p data-id="p-3">');
  doc.saveBlock("p-5", "Another.", "Another one.");
  assert.throws(() => doc.undoAgentChange("p-5"), (e: Error) => e instanceof CantUndo && /changed since/.test(e.message));
  doc.undoAgentChange("p-4");
  assert.ok(!read().includes("p-4"));
  assert.match(lines.at(-1)!, /undid the agent's addition of p-4, so it's gone again: "A new paragraph\."$/);
  assert.deepEqual(pending(doc), ["added p-5"]);
});

test("undoing a removal puts the block back where it was, or next to another old neighbour", () => {
  const { doc, agent, read } = open();
  agent(/\n  <li data-id="li-2">Two<\/li>/, "");
  assert.deepEqual(pending(doc), ["removed li-2"]);
  assert.equal(doc.pendingChanges()[0].before, "Two");
  doc.undoAgentChange("li-2");
  assert.equal(read(), DOC);

  agent(/\n  <li data-id="li-2">Two<\/li>/, "");
  agent(/\n  <li data-id="li-3">Three<\/li>/, "");
  doc.undoAgentChange("li-2"); // its next neighbour is gone too, so it goes after li-1
  assert.match(read(), /<li data-id="li-1">One<\/li>\n  <li data-id="li-2">Two<\/li>\n<\/ul>/);
});

test("undoing a move puts the block back", () => {
  const { doc, agent, read, lines } = open();
  agent(/(\n  <li data-id="li-1">One<\/li>)(\n  <li data-id="li-2">Two<\/li>\n  <li data-id="li-3">Three<\/li>)/, "$2$1");
  assert.deepEqual(pending(doc), ["moved li-1"]);
  doc.undoAgentChange("li-1");
  assert.equal(read(), DOC);
  assert.match(lines.at(-1)!, /undid the agent's move of li-1: moved it back before li-2 \(inside ul-1\)$/);
});

test("a block that's gone, or a change already dealt with, can't be undone", () => {
  const { doc, agent } = open();
  agent("opens in May", "opens in June");
  doc.keepAgentChange("p-1");
  assert.throws(() => doc.undoAgentChange("p-1"), CantUndo);
  agent("Two beds", "Three beds");
  agent(/<p data-id="p-2">[^<]*<\/p>\n/, "");
  // The agent then removed it: what's pending is the removal, which puts back the original.
  assert.deepEqual(pending(doc), ["removed p-2"]);
  doc.undoAgentChange("p-2");
  assert.equal(inner(doc.source(), "p-2"), "Two beds stay open for anyone.");
});

test("pending changes survive a restart, and changes to blocks removed meanwhile are dropped", () => {
  const { agent, make, path } = open();
  agent("opens in May", "opens in June");
  agent("Two beds", "Three beds");
  // While inplace isn't running, someone removes p-2.
  writeFileSync(path, readFileSync(path, "utf8").replace(/<p data-id="p-2">[^<]*<\/p>\n/, ""));
  const again = make();
  assert.deepEqual(pending(again), ["changed p-1"]);
  again.undoAgentChange("p-1");
  assert.equal(inner(again.source(), "p-1"), "The roof garden opens in May.");
});

test("an undo right after an agent write it hasn't seen yet keeps that write", () => {
  const { doc, agent, path } = open();
  agent("opens in May", "opens in June");
  // The agent writes again, to this block and another, and inplace hasn't polled yet.
  writeFileSync(path, readFileSync(path, "utf8").replace("The roof garden", "The roof terrace garden").replace("Two beds", "Three beds"));
  doc.undoAgentChange("p-1");
  const text = doc.source();
  // Both of the agent's changes to p-1 were one change, so both are undone; p-2 keeps the agent's edit.
  assert.equal(inner(text, "p-1"), "The roof garden opens in May.");
  assert.equal(inner(text, "p-2"), "Three beds stay open for anyone.");
  assert.deepEqual(pending(doc), ["changed p-2"]);
});

test("the user's own removal of a changed block ends the change", () => {
  const { doc, agent } = open();
  agent(">Three<", "><");
  doc.removeBlock("li-3");
  assert.deepEqual(pending(doc), []);
});
