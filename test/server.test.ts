import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createInplaceServer, Document, isLocalHost } from "../src/server.js";

/** A server for a one-paragraph document, and a raw request helper that sets every header itself. */
async function start() {
  const dir = mkdtempSync(join(tmpdir(), "inplace-server-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, '<html><body><p data-id="p-1">Hello</p></body></html>');
  const server = createInplaceServer(new Document(path, true, () => {}, dir));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  const send = (method: string, path: string, headers: Record<string, string>, body?: string) =>
    new Promise<{ status: number; body: string }>((ok, fail) => {
      const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => ok({ status: res.statusCode!, body: text }));
      });
      req.on("error", fail);
      req.end(body);
    });
  return { path, port, send, close: () => server.close() };
}

const insert = JSON.stringify({ id: "p-1", position: "after", tag: "p", content: "<script>alert(1)</script>" });

test("a same-origin JSON change is saved", async () => {
  const s = await start();
  try {
    const host = `localhost:${s.port}`;
    const res = await s.send("POST", "/__inplace/insert",
      { host, origin: `http://${host}`, "content-type": "application/json" },
      JSON.stringify({ id: "p-1", position: "after", tag: "p", content: "World" }));
    assert.equal(res.status, 200, res.body);
    assert.match(readFileSync(s.path, "utf8"), /<p data-id="p-2">World<\/p>/);
  } finally {
    s.close();
  }
});

test("a change from another website is refused", async () => {
  const s = await start();
  try {
    const res = await s.send("POST", "/__inplace/insert",
      { host: `127.0.0.1:${s.port}`, origin: "https://evil.example", "content-type": "application/json" }, insert);
    assert.equal(res.status, 403);
    assert.doesNotMatch(readFileSync(s.path, "utf8"), /script/);
  } finally {
    s.close();
  }
});

test("a text/plain change, which browsers send cross-origin without asking, is refused", async () => {
  const s = await start();
  try {
    const res = await s.send("POST", "/__inplace/insert", { host: `127.0.0.1:${s.port}`, "content-type": "text/plain" }, insert);
    assert.equal(res.status, 403);
    assert.doesNotMatch(readFileSync(s.path, "utf8"), /script/);
  } finally {
    s.close();
  }
});

test("requests for an unknown host name are refused (DNS rebinding)", async () => {
  const s = await start();
  try {
    const host = `attacker.example:${s.port}`;
    const post = await s.send("POST", "/__inplace/insert",
      { host, origin: `http://${host}`, "content-type": "application/json" }, insert);
    assert.equal(post.status, 403);
    assert.doesNotMatch(readFileSync(s.path, "utf8"), /script/);
    for (const path of ["/", "/__inplace/history", "/__inplace/stash"]) {
      assert.equal((await s.send("GET", path, { host })).status, 403, path);
    }
    assert.equal((await s.send("GET", "/__inplace/history", { host: `localhost:${s.port}` })).status, 200);
  } finally {
    s.close();
  }
});

test("isLocalHost accepts this computer's names and IP addresses only", () => {
  for (const ok of ["localhost:8765", "127.0.0.1:8765", "[::1]:8765", "192.168.1.20:8765", "LOCALHOST"]) {
    assert.ok(isLocalHost(ok), ok);
  }
  for (const bad of [undefined, "", "attacker.example:8765", "localhost.attacker.example", "127.0.0.1.nip.io"]) {
    assert.ok(!isLocalHost(bad), String(bad));
  }
});
