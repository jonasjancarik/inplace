import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

test("comments are added from the page, listed, and resolved by the agent", async () => {
  const s = await start();
  try {
    const host = `localhost:${s.port}`;
    const page = { host, origin: `http://${host}`, "content-type": "application/json" };
    const add = await s.send("POST", "/__inplace/comment", page,
      JSON.stringify({ action: "add", id: "p-1", text: "Say hello to whom?", quote: "Hello", prefix: "", suffix: "" }));
    assert.equal(add.status, 200, add.body);
    assert.equal((await s.send("POST", "/__inplace/comment", page, JSON.stringify({ action: "add", id: "p-9", text: "x" }))).status, 404);
    // The agent resolves from the command line: no Origin header.
    const resolved = await s.send("POST", "/__inplace/comment", { host, "content-type": "application/json" },
      JSON.stringify({ action: "resolve", n: 1, reply: "Added a name." }));
    assert.equal(resolved.status, 200, resolved.body);
    const listed = JSON.parse((await s.send("GET", "/__inplace/comments", { host })).body);
    assert.deepEqual(listed.comments.map((c: { n: number; status: string; reply: string }) => [c.n, c.status, c.reply]),
      [[1, "done", "Added a name."]]);
    assert.equal(JSON.parse((await s.send("GET", "/__inplace/comments?open=1", { host })).body).comments.length, 0);
    const other = await s.send("POST", "/__inplace/comment",
      { host, origin: "https://evil.example", "content-type": "application/json" }, JSON.stringify({ action: "clear" }));
    assert.equal(other.status, 403);
    assert.match((await s.send("GET", "/__inplace/anchor.js", { host })).body, /export function findQuote/);
  } finally {
    s.close();
  }
});

test("the agent leaves its own comments, which the page can answer but not forge", async () => {
  const s = await start();
  try {
    const host = `localhost:${s.port}`;
    const agent = { host, "content-type": "application/json" };
    const page = { ...agent, origin: `http://${host}` };
    const add = (headers: Record<string, string>, fields: Record<string, unknown>) =>
      s.send("POST", "/__inplace/comment", headers, JSON.stringify({ action: "add", by: "agent", ...fields }));

    const added = await add(agent, { id: "p-1", text: "Hello to whom?", quote: "ell" });
    assert.equal(added.status, 200, added.body);
    assert.deepEqual(JSON.parse(added.body).comment, {
      ...JSON.parse(added.body).comment, n: 1, by: "agent", quote: "ell", prefix: "H", suffix: "o", status: "open",
    });
    assert.equal((await add(page, { id: "p-1", text: "Forged" })).status, 403);
    assert.equal((await add(agent, { id: "p-1", text: "x", quote: "Goodbye" })).status, 400);
    assert.match(JSON.parse((await add(agent, { id: "p-9", text: "x" })).body).error, /no element with data-id "p-9"/);

    assert.equal((await s.send("POST", "/__inplace/comment", page, JSON.stringify({ action: "edit", n: 1, text: "x" }))).status, 400);
    const answered = await s.send("POST", "/__inplace/comment", page, JSON.stringify({ action: "answer", n: 1, text: "The reader." }));
    assert.equal(answered.status, 200, answered.body);
    assert.equal(JSON.parse(answered.body).comment.answer, "The reader.");
  } finally {
    s.close();
  }
});

test("files next to the document are served, but not hidden ones or ones a link leads outside to", async () => {
  const s = await start();
  const dir = dirname(s.path);
  const outside = mkdtempSync(join(tmpdir(), "inplace-outside-"));
  try {
    mkdirSync(join(dir, "img"));
    writeFileSync(join(dir, "img", "a.png"), "png");
    writeFileSync(join(dir, "style.css"), "p {}");
    writeFileSync(join(dir, ".env"), "SECRET=1");
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "config"), "[core]");
    writeFileSync(join(dir, "notes.sqlite"), "data");
    writeFileSync(join(outside, "secret.css"), "secret");
    symlinkSync(outside, join(dir, "linked"));
    symlinkSync(join(dir, ".env"), join(dir, "env.css"));
    symlinkSync(join(dir, "img", "a.png"), join(dir, "logo.png"));
    const get = (path: string) => s.send("GET", path, { host: `localhost:${s.port}` });
    assert.equal((await get("/img/a.png")).status, 200);
    assert.equal((await get("/style.css")).body, "p {}");
    assert.equal((await get("/logo.png")).body, "png", "a link to another file in the folder still works");
    for (const path of ["/.env", "/.git/config", "/%2egit/config", "/img/../.env", "/notes.sqlite", "/linked/secret.css", "/env.css"]) {
      const res = await get(path);
      assert.equal(res.status, 404, path);
      assert.doesNotMatch(res.body, /SECRET|core|data|secret/, path);
    }
  } finally {
    s.close();
  }
});
