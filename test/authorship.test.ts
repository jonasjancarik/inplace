import assert from "node:assert/strict";
import { request } from "node:http";
import { type AddressInfo } from "node:net";
import { test } from "node:test";

import { readAuthor } from "../src/history.js";
import { createInplaceServer, Document, type Person } from "../src/server.js";
import { MemoryStore } from "../src/store.js";

const PAGE = `<html><body>
<p data-id="p-1">One</p>
<p data-id="p-2">Two</p>
<p data-id="p-3">Three</p>
</body></html>`;

const jana: Person = { id: "u-jana", name: "Jana" };
const petr: Person = { id: "u-petr", name: "Petr" };

/** A document in memory that remembers what was saved beside it, and can be opened again. */
function setup(text = PAGE, side: Record<string, string> = {}) {
  const saved: Record<string, string> = { ...side };
  const store = new MemoryStore("doc.html", text, saved, () => {}, (key, json) => { saved[key] = json; });
  const lines: string[] = [];
  const doc = new Document(store, true, (line) => lines.push(line));
  return { store, doc, saved, lines };
}

const summary = (doc: Document) => Object.fromEntries(Object.entries(doc.authorMarks()).map(([id, m]) => [id, [m.by.kind, m.by.name, m.addedBy?.name]]));

test("old saved authors are still read", () => {
  assert.deepEqual(readAuthor("you"), { kind: "person" });
  assert.deepEqual(readAuthor("agent"), { kind: "agent" });
  assert.deepEqual(readAuthor({ kind: "person", id: "u1", name: "Jana", extra: 1 }), { kind: "person", id: "u1", name: "Jana" });
  assert.equal(readAuthor({ kind: "robot" }), undefined);
});

test("blocks nobody has written yet have no mark", () => {
  const { doc } = setup();
  doc.load();
  assert.deepEqual(doc.authorMarks(), {});
});

test("each block is marked with who changed it last, and who added it", () => {
  const { doc } = setup();
  doc.load();
  doc.saveBlock("p-1", "One", "One!", jana);
  doc.replaceElement("p-2", "inner", "Two", "Two!", { name: "Claude" });
  const added = doc.insertBlock("p-3", "after", "p", "Fresh", undefined, petr);
  doc.saveBlock(added.id, "Fresh", "Fresher", jana);
  assert.deepEqual(summary(doc)["p-1"], ["person", "Jana", undefined]);
  assert.deepEqual(summary(doc)["p-2"], ["agent", "Claude", undefined]);
  assert.deepEqual(summary(doc)[added.id], ["person", "Jana", "Petr"]);
  assert.equal(summary(doc)["p-3"], undefined);
});

test("a move doesn't count as writing, and a removed block loses its mark", () => {
  const { doc } = setup();
  doc.load();
  doc.saveBlock("p-1", "One", "One!", jana);
  doc.moveBlock("p-1", "p-3", "after", petr);
  assert.deepEqual(summary(doc)["p-1"], ["person", "Jana", undefined]);
  doc.saveBlock("p-1", "One!", "", jana);
  doc.removeBlock("p-1", petr);
  assert.equal(summary(doc)["p-1"], undefined);
});

test("the marks survive a restart", () => {
  const { store, doc, saved } = setup();
  doc.load();
  doc.saveBlock("p-1", "One", "One!", jana);
  const again = new Document(new MemoryStore("doc.html", store.read(), saved), true);
  assert.deepEqual(summary(again)["p-1"], ["person", "Jana", undefined]);
});

test("a block changed while inplace wasn't running becomes unknown again", () => {
  const { store, doc, saved } = setup();
  doc.load();
  doc.saveBlock("p-1", "One", "One!", jana);
  doc.saveBlock("p-2", "Two", "Two!", petr);
  const outside = store.read().replace("Two!", "Two, by hand");
  const again = new Document(new MemoryStore("doc.html", outside, saved), true);
  assert.deepEqual(Object.keys(again.authorMarks()), ["p-1"]);
});

test("a change to the file while inplace runs is the agent's", () => {
  const { store, doc } = setup();
  doc.load();
  store.write(store.read().replace("Three", "Three, rewritten"));
  doc.poll();
  assert.deepEqual(summary(doc)["p-3"], ["agent", undefined, undefined]);
});

test("the author option names the person in the marks, the history and the change lines", async (t) => {
  const { doc, lines } = setup();
  doc.load();
  const people = new Map([["jana", jana], ["petr", petr]]);
  const server = createInplaceServer(doc, { author: (req) => people.get(String(req.headers["x-user"])) });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  const call = (path: string, user: string | undefined, body?: object) =>
    new Promise<{ status: number; json: any }>((ok, fail) => {
      const headers = { host: `127.0.0.1:${port}`, "content-type": "application/json", ...(user ? { "x-user": user } : {}) };
      const req = request({ host: "127.0.0.1", port, path, method: body ? "POST" : "GET", headers }, (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => ok({ status: res.statusCode!, json: JSON.parse(text) }));
      });
      req.on("error", fail);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  t.after(() => server.close());
  await call("/__inplace/save", "jana", { id: "p-1", old: "One", new: "One by Jana" });
  await call("/__inplace/save", "petr", { id: "p-2", old: "Two", new: "Two by Petr" });
  await call("/__inplace/save", undefined, { id: "p-3", old: "Three", new: "Three by me" });
  await call("/__inplace/comment", "petr", { action: "add", id: "p-1", text: "Check this" });
  const history = (await call("/__inplace/history", "jana")).json;
  assert.deepEqual(history.entries.map((e: any) => e.by), [
    { kind: "person", id: "u-jana", name: "Jana" }, { kind: "person", id: "u-petr", name: "Petr" }, { kind: "person" },
  ]);
  assert.equal(history.me, "u-jana");
  assert.equal(history.authors["p-2"].by.name, "Petr");
  assert.equal(history.authors["p-3"].by.id, undefined);
  assert.equal(doc.comments.list()[0].from?.name, "Petr");
  assert.ok(lines.some((l) => l.includes("edited p-2 (Petr):")), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes("comment #1 by Petr on p-1")), lines.join("\n"));
  assert.ok(lines.some((l) => /edited p-3:/.test(l)));
});

test("a host's agent can be named when it edits and comments", () => {
  const { doc } = setup();
  doc.load();
  const c = doc.addAgentComment("p-1", "Is this right?", undefined, undefined, { name: "Claude" });
  assert.deepEqual(c.by, { kind: "agent", name: "Claude" });
  doc.findReplace("Three", "3", false, { id: "bot-1" });
  assert.deepEqual(doc.authorMarks()["p-3"].by, { kind: "agent", id: "bot-1" });
});
