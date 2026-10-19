import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { documentIdOf, withDocumentId } from "../src/htmldoc.js";
import { createInplaceHandler, Document, FileStore, MemoryStore } from "../src/index.js";

test("a document kept in a host's own store is edited, commented on and served under the host's names", async () => {
  const saved: string[] = [];
  const side: Record<string, string> = {};
  const store = new MemoryStore("report.html", '<html><body><p data-id="p-1">Hello</p></body></html>', {},
    (text) => saved.push(text), (key, json) => (side[key] = json));
  const doc = new Document(store);
  const server = createServer(createInplaceHandler(doc, { hostAllowed: (host) => host === "d1.docs.example.com" }));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  const send = (method: string, path: string, host: string, body?: string) =>
    new Promise<{ status: number; body: string }>((ok, fail) => {
      const headers: Record<string, string> = { host, ...(body ? { "content-type": "application/json", origin: `https://${host}` } : {}) };
      const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => ok({ status: res.statusCode!, body: text }));
      });
      req.on("error", fail);
      req.end(body);
    });
  try {
    assert.equal((await send("GET", "/", "localhost")).status, 403, "only the host's own names reach the document");
    const page = await send("GET", "/", "d1.docs.example.com");
    assert.equal(page.status, 200);
    assert.match(page.body, /data-file="report\.html"/);
    const edit = await send("POST", "/__inplace/save", "d1.docs.example.com", JSON.stringify({ id: "p-1", old: "Hello", new: "Hello there" }));
    assert.equal(edit.status, 200, edit.body);
    assert.match(saved.at(-1)!, /<p data-id="p-1">Hello there<\/p>/);
    const comment = await send("POST", "/__inplace/comment", "d1.docs.example.com", JSON.stringify({ action: "add", id: "p-1", text: "Shorter?" }));
    assert.equal(comment.status, 200, comment.body);
    assert.equal(JSON.parse(side.comments).comments[0].text, "Shorter?");
    assert.equal((await send("GET", "/logo.png", "d1.docs.example.com")).status, 404, "a store without a folder serves no files");
    // The comments come back when the document is opened again from the same store.
    assert.equal(new Document(new MemoryStore("report.html", store.read(), side)).comments.list()[0].text, "Shorter?");
  } finally {
    server.close();
  }
});

test("comments follow a document when it's moved, and a copy gets its own", () => {
  const side = mkdtempSync(join(tmpdir(), "inplace-side-"));
  const dir = mkdtempSync(join(tmpdir(), "inplace-move-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, "<!doctype html><html><head><title>Plan</title></head><body><p>Ten trees</p></body></html>");
  const doc = new Document(path, true, () => {}, side);
  doc.load();
  assert.match(readFileSync(path, "utf8"), /<head><meta name="inplace-id" content="[0-9a-f]{12}"><title>/);
  doc.comments.add({ id: "p-1", text: "Name the trees." });

  const moved = join(dir, "renamed.html");
  renameSync(path, moved);
  const again = new Document(moved, true, () => {}, side);
  assert.deepEqual(again.comments.list().map((c) => c.text), ["Name the trees."]);

  const copy = join(dir, "copy.html");
  copyFileSync(moved, copy);
  const copied = new Document(copy, true, () => {}, side);
  assert.deepEqual(copied.comments.list().map((c) => c.text), ["Name the trees."], "a copy starts with the original's comments");
  copied.load();
  assert.notEqual(documentIdOf(readFileSync(copy, "utf8")), documentIdOf(readFileSync(moved, "utf8")), "and gets an id of its own");
  copied.comments.add({ id: "p-1", text: "Only in the copy." });
  assert.equal(new Document(moved, true, () => {}, side).comments.list().length, 1);
  assert.equal(new Document(copy, true, () => {}, side).comments.list().length, 2);
});

test("the id goes where the parser puts the head, and is put back if it's removed", () => {
  assert.equal(withDocumentId("<!doctype html><body><p>Hi</p></body>", "abc"),
    '<!doctype html><meta name="inplace-id" content="abc"><body><p>Hi</p></body>');
  assert.equal(withDocumentId("<html><body>x</body></html>", "abc"), '<html><meta name="inplace-id" content="abc"><body>x</body></html>');
  assert.equal(withDocumentId('<head><meta name="inplace-id" content="old"></head>', "new"), '<head><meta name="inplace-id" content="new"></head>');

  const side = mkdtempSync(join(tmpdir(), "inplace-side-"));
  const path = join(mkdtempSync(join(tmpdir(), "inplace-meta-")), "doc.html");
  writeFileSync(path, "<!doctype html><head></head><body><p>Ten trees</p></body>");
  const doc = new Document(path, true, () => {}, side);
  doc.load();
  const id = documentIdOf(readFileSync(path, "utf8"));
  writeFileSync(path, readFileSync(path, "utf8").replace(/<meta[^>]*>/, ""));
  doc.load();
  assert.equal(documentIdOf(readFileSync(path, "utf8")), id);
});

test("without ids written, comments are found by the file's real path, also through a link", () => {
  const side = mkdtempSync(join(tmpdir(), "inplace-side-"));
  const dir = mkdtempSync(join(tmpdir(), "inplace-link-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, "<!doctype html><body><p data-id=\"p-1\">Ten trees</p></body>");
  new Document(path, false, () => {}, side).comments.add({ id: "p-1", text: "Name the trees." });
  const link = join(dir, "link.html");
  symlinkSync(path, link);
  assert.equal(new Document(link, false, () => {}, side).comments.list().length, 1);
  assert.equal(documentIdOf(readFileSync(path, "utf8")), undefined, "nothing written");
});

test("comments kept in the temporary folder by an older inplace move to the new place", () => {
  const path = join(mkdtempSync(join(tmpdir(), "inplace-old-")), "doc.html");
  writeFileSync(path, "<!doctype html><body><p data-id=\"p-1\">Ten trees</p></body>");
  const old = join(tmpdir(), "inplace", `comments-${createHash("sha1").update(resolve(path)).digest("hex").slice(0, 12)}.json`);
  mkdirSync(dirname(old), { recursive: true });
  writeFileSync(old, JSON.stringify({ last: 1, comments: [{ n: 1, id: "p-1", text: "Name the trees.", status: "open", created: "" }] }));
  const doc = new Document(path);
  assert.deepEqual(doc.comments.list().map((c) => c.text), ["Name the trees."]);
  assert.ok(!existsSync(old));
  assert.ok((doc.store as FileStore).sidePath("comments").startsWith(process.env.INPLACE_STATE_DIR!));
});
