import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { type AddressInfo } from "node:net";
import { test } from "node:test";

import { createInplaceHandler, Document, MemoryStore } from "../src/index.js";

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
