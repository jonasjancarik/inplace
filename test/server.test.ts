import assert from "node:assert/strict";
import {
  chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, utimesSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { AGENT, YOU } from "../src/history.js";

import { BlockConflict } from "../src/htmldoc.js";
import { allowedHostName, createInplaceServer, Document, isLocalHost, type ServerOptions } from "../src/server.js";

/** A server for a one-paragraph document, and a raw request helper that sets every header itself. */
async function start(options: ServerOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "inplace-server-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, '<html><body><p data-id="p-1">Hello</p></body></html>');
  const server = createInplaceServer(new Document(path, true, () => {}, dir), options);
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

test("--allow-host adds exact names, such as a Tailscale MagicDNS name, and nothing else", async () => {
  const allow = ["mymac.tail1234.ts.net"];
  assert.ok(isLocalHost("mymac.tail1234.ts.net:8765", allow));
  assert.ok(isLocalHost("MyMac.Tail1234.ts.net.", allow));
  for (const bad of ["mymac.tail1234.ts.net.attacker.example", "other.tail1234.ts.net", "tail1234.ts.net"]) {
    assert.ok(!isLocalHost(bad, allow), bad);
  }
  assert.ok(!isLocalHost("mymac.tail1234.ts.net"), "not without --allow-host");

  assert.equal(allowedHostName(" MyMac.Tail1234.ts.net. "), "mymac.tail1234.ts.net");
  for (const bad of ["", "mymac.ts.net:8765", "http://mymac.ts.net", "*.ts.net", "my mac", "a..b"]) {
    assert.equal(allowedHostName(bad), null, bad);
  }

  const s = await start({ allowHosts: allow });
  try {
    const host = `mymac.tail1234.ts.net:${s.port}`;
    assert.equal((await s.send("GET", "/", { host })).status, 200);
    const res = await s.send("POST", "/__inplace/insert",
      { host, origin: `http://${host}`, "content-type": "application/json" },
      JSON.stringify({ id: "p-1", position: "after", tag: "p", content: "World" }));
    assert.equal(res.status, 200, res.body);
    assert.equal((await s.send("GET", "/", { host: `attacker.example:${s.port}` })).status, 403);
  } finally {
    s.close();
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
      ...JSON.parse(added.body).comment, n: 1, by: AGENT, quote: "ell", prefix: "H", suffix: "o", status: "open",
    });
    assert.equal((await add(page, { id: "p-1", text: "Forged" })).status, 403);

    const asked = await add(agent, { id: "p-1", text: "Formal?", options: [" Yes,  formal ", "No", "No", ""] });
    assert.deepEqual(JSON.parse(asked.body).comment.options, ["Yes, formal", "No"]);
    assert.match(JSON.parse((await add(agent, { id: "p-1", text: "x", options: ["a", "b", "c", "d"] })).body).error, /at most 3/);
    const fromPage = await s.send("POST", "/__inplace/comment", page, JSON.stringify({ action: "add", id: "p-1", text: "x", options: ["a"] }));
    assert.equal(JSON.parse(fromPage.body).comment.options, undefined);
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

/** A one-paragraph document in a new folder. */
function docFile(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "inplace-save-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, '<html><body><p data-id="p-1">Hello</p></body></html>');
  return { dir, path };
}

test("saving a document opened through a link changes the file it leads to and keeps the link", () => {
  const { dir, path } = docFile();
  const link = join(mkdtempSync(join(tmpdir(), "inplace-link-")), "link.html");
  symlinkSync(path, link);
  const doc = new Document(link, true, () => {}, dir);
  doc.saveBlock("p-1", "Hello", "Hello there");
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.match(readFileSync(path, "utf8"), /Hello there/);
  assert.deepEqual(readdirSync(dirname(link)), ["link.html"], "no temporary file is left next to the link");
  // Changes made to the real file are still noticed.
  const before = doc.version;
  writeFileSync(path, '<html><body><p data-id="p-1">Changed by the agent, at length</p></body></html>');
  doc.poll();
  assert.notEqual(doc.version, before);
});

test("saving keeps the document's permissions and its other hard links", () => {
  const { dir, path } = docFile();
  chmodSync(path, 0o640);
  const doc = new Document(path, true, () => {}, dir);
  doc.saveBlock("p-1", "Hello", "Hello there");
  assert.equal(statSync(path).mode & 0o777, 0o640);

  const other = join(dir, "other.html");
  linkSync(path, other);
  doc.saveBlock("p-1", "Hello there", "Hello again");
  assert.match(readFileSync(other, "utf8"), /Hello again/);
  assert.equal(statSync(path).ino, statSync(other).ino);
  assert.equal(statSync(path).mode & 0o777, 0o640);
});

/** A document with two paragraphs, and a way to change the file the way an agent would. */
function twoParagraphs() {
  const dir = mkdtempSync(join(tmpdir(), "inplace-cache-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, '<html><body><p data-id="p-1">Hello</p>\n<p data-id="p-2">World</p></body></html>');
  const doc = new Document(path, true, () => {}, dir);
  doc.load();
  const read = () => readFileSync(path, "utf8");
  // Change the file, then give it back the size and modification time it had, as a quick
  // second write can on a file system that keeps times coarsely. The time is first set to a
  // whole second, which every file system keeps exactly, and inplace is shown it unchanged.
  const agent = (from: string, to: string) => {
    utimesSync(path, 1_700_000_000, 1_700_000_000);
    doc.poll();
    const before = statSync(path);
    writeFileSync(path, read().replace(from, to));
    utimesSync(path, 1_700_000_000, 1_700_000_000);
    const after = statSync(path);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  };
  return { doc, read, agent };
}

test("a change to the file between two saves is kept, even with the same size and time", () => {
  const { doc, read, agent } = twoParagraphs();
  doc.saveBlock("p-1", "Hello", "Hello there");
  agent("World", "Earth");
  doc.saveBlock("p-1", "Hello there", "Hello again");
  assert.match(read(), /<p data-id="p-1">Hello again<\/p>\n<p data-id="p-2">Earth<\/p>/);
  assert.deepEqual(doc.history.entries.map((e) => e.by), [YOU, AGENT, YOU]);
});

test("a change to the same block between two saves is still a conflict", () => {
  const { doc, read, agent } = twoParagraphs();
  doc.saveBlock("p-1", "Hello", "Hello there");
  agent("Hello there", "Hi there yo");
  assert.throws(() => doc.saveBlock("p-1", "Hello there", "Howdy there"), BlockConflict);
  assert.match(read(), /Hi there yo/);
  assert.equal(doc.stashCount, 1);
});

test("each save builds on inplace's own last write", () => {
  const { doc, read } = twoParagraphs();
  const version = doc.version;
  doc.saveBlock("p-1", "Hello", "Hello there");
  assert.notEqual(doc.version, version);
  doc.saveBlock("p-1", "Hello there", "Hello again");
  doc.saveBlock("p-2", "World", "Earth");
  doc.poll();
  assert.match(read(), /<p data-id="p-1">Hello again<\/p>\n<p data-id="p-2">Earth<\/p>/);
  assert.ok(doc.history.entries.every((e) => e.by.kind === "person"));
  assert.equal(doc.source("p-1"), '<p data-id="p-1">Hello again</p>');
});

// --- what the person may do: edit, comment or only read ---

/** One valid request for every action the page sends, in the order they're tried. */
const EDIT_REQUESTS: [string, object][] = [
  ["save", { id: "p-1", old: "Hello", new: "Changed" }],
  ["move", { id: "p-1", target: "p-1", position: "after" }],
  ["retag", { id: "p-1", from: "p", to: "h2" }],
  ["insert", { id: "p-1", position: "after", tag: "p", content: "More" }],
  ["remove", { id: "p-1" }],
  ["undo", { id: "p-1", kind: "add" }],
  ["stash/resolve", { n: 1, action: "discard" }],
  ["suggestion/undo", { id: "p-1" }],
  ["suggestion/keep", { id: "p-1" }],
  ["suggestion/keep-all", {}],
];
const COMMENT_REQUESTS: object[] = [
  { action: "add", id: "p-1", text: "Why?" },
  { action: "edit", n: 1, text: "Why so?" },
  { action: "answer", n: 1, text: "Because" },
  { action: "dismiss", n: 1 },
  { action: "delete", n: 1 },
  { action: "clear" },
  { action: "resolve", n: 1 },
  { action: "add", by: "agent", id: "p-1", text: "Check this" },
];

test("below edit access, every change to the document is refused with 403 and the file stays as it was", async () => {
  for (const level of ["comment", "view"] as const) {
    const s = await start({ access: () => level });
    try {
      const host = `localhost:${s.port}`;
      const page = { host, origin: `http://${host}`, "content-type": "application/json" };
      const before = readFileSync(s.path, "utf8");
      for (const [action, body] of EDIT_REQUESTS) {
        const res = await s.send("POST", `/__inplace/${action}`, page, JSON.stringify(body));
        assert.equal(res.status, 403, `${action} at ${level}: ${res.body}`);
        assert.match(JSON.parse(res.body).error, /not edit/);
      }
      assert.equal(readFileSync(s.path, "utf8"), before);
    } finally {
      s.close();
    }
  }
});

test("at view access every comment action is refused too, and comment access allows them", async () => {
  const view = await start({ access: () => "view" });
  const comment = await start({ access: () => "comment" });
  try {
    for (const s of [view, comment]) {
      const host = `localhost:${s.port}`;
      const page = { host, "content-type": "application/json" };
      for (const body of COMMENT_REQUESTS) {
        const res = await s.send("POST", "/__inplace/comment", page, JSON.stringify(body));
        if (s === view) {
          assert.equal(res.status, 403, JSON.stringify(body));
          assert.match(JSON.parse(res.body).error, /comment on it/);
        } else assert.notEqual(res.status, 403, `${JSON.stringify(body)}: ${res.body}`);
      }
    }
    assert.equal(JSON.parse((await view.send("GET", "/__inplace/comments", { host: `localhost:${view.port}` })).body).comments.length, 0);
  } finally {
    view.close();
    comment.close();
  }
});

test("with named people, only the one who wrote a comment edits or deletes it, and anyone may answer the agent's", async () => {
  const people: Record<string, { id: string; name: string }> = { ann: { id: "u1", name: "Ann" }, bo: { id: "u2", name: "Bo" } };
  const s = await start({
    access: () => "comment",
    author: (req) => people[String(req.headers["x-person"])],
  });
  try {
    const call = async (who: string, body: object, extra: Record<string, string> = {}) =>
      s.send("POST", "/__inplace/comment", { host: `localhost:${s.port}`, "content-type": "application/json", "x-person": who, ...extra }, JSON.stringify(body));
    const list = async () => JSON.parse((await s.send("GET", "/__inplace/comments", { host: `localhost:${s.port}` })).body).comments;
    assert.equal((await call("ann", { action: "add", id: "p-1", text: "Ann's note" })).status, 200);
    assert.deepEqual((await list())[0].from, { kind: "person", id: "u1", name: "Ann" });

    // Bo can't touch Ann's comment, and it stays as it was.
    for (const body of [{ action: "edit", n: 1, text: "Hijacked" }, { action: "delete", n: 1 }]) {
      const res = await call("bo", body);
      assert.equal(res.status, 403, JSON.stringify(body));
      assert.match(JSON.parse(res.body).error, /your own comments/);
    }
    assert.equal((await list())[0].text, "Ann's note");

    // Ann can edit and delete her own.
    assert.equal((await call("ann", { action: "edit", n: 1, text: "Better note" })).status, 200);
    assert.equal((await list())[0].text, "Better note");
    assert.equal((await call("bo", { action: "add", id: "p-1", text: "Bo's note" })).status, 200);
    assert.equal((await call("ann", { action: "delete", n: 2 })).status, 403);
    assert.equal((await call("bo", { action: "delete", n: 2 })).status, 200);

    // The agent's comments can be answered or dismissed by anyone at comment level.
    const asAgent = { host: `localhost:${s.port}`, "content-type": "application/json" };
    for (const text of ["First?", "Second?"]) {
      await s.send("POST", "/__inplace/comment", asAgent, JSON.stringify({ action: "add", by: "agent", id: "p-1", text }));
    }
    assert.equal((await call("bo", { action: "answer", n: 3, text: "Yes" })).status, 200);
    assert.equal((await call("ann", { action: "dismiss", n: 4 })).status, 200);
  } finally {
    s.close();
  }
});

test("without named people, anyone may edit or delete any comment", async () => {
  const s = await start({ access: () => "comment" });
  try {
    const call = (body: object) =>
      s.send("POST", "/__inplace/comment", { host: `localhost:${s.port}`, "content-type": "application/json" }, JSON.stringify(body));
    await call({ action: "add", id: "p-1", text: "A note" });
    assert.equal((await call({ action: "edit", n: 1, text: "Changed" })).status, 200);
    assert.equal((await call({ action: "delete", n: 1 })).status, 200);
  } finally {
    s.close();
  }
});

test("at edit access, and with no access option, nothing is refused", async () => {
  for (const options of [{ access: () => "edit" as const }, {}]) {
    const s = await start(options);
    try {
      const host = `localhost:${s.port}`;
      const page = { host, origin: `http://${host}`, "content-type": "application/json" };
      const res = await s.send("POST", "/__inplace/save", page, JSON.stringify({ id: "p-1", old: "Hello", new: "Changed" }));
      assert.equal(res.status, 200, res.body);
      assert.match(readFileSync(s.path, "utf8"), />Changed</);
      const added = await s.send("POST", "/__inplace/comment", page, JSON.stringify({ action: "add", id: "p-1", text: "Why?" }));
      assert.equal(added.status, 200, added.body);
    } finally {
      s.close();
    }
  }
});

test("the agent's changes are listed with the history, and the page can undo or keep them", async () => {
  const s = await start();
  try {
    const host = `localhost:${s.port}`;
    const page = { host, origin: `http://${host}`, "content-type": "application/json" };
    const history = async () => JSON.parse((await s.send("GET", "/__inplace/history", { host })).body);
    await history(); // inplace has seen the file
    writeFileSync(s.path, readFileSync(s.path, "utf8").replace("Hello", "Hello there"));
    const { pending } = await history();
    assert.deepEqual(pending.map((p: { kind: string; id: string; before: string; undoable: boolean }) => [p.kind, p.id, p.before, p.undoable]),
      [["changed", "p-1", "Hello", true]]);
    const undone = await s.send("POST", "/__inplace/suggestion/undo", page, JSON.stringify({ id: "p-1" }));
    assert.equal(undone.status, 200, undone.body);
    assert.ok(JSON.parse(undone.body).editable.includes("p-1"));
    assert.match(readFileSync(s.path, "utf8"), /<p data-id="p-1">Hello<\/p>/);
    assert.deepEqual((await history()).pending, []);
    const again = await s.send("POST", "/__inplace/suggestion/undo", page, JSON.stringify({ id: "p-1" }));
    assert.equal(again.status, 409);
    assert.match(JSON.parse(again.body).error, /kept or undone already/);
    writeFileSync(s.path, readFileSync(s.path, "utf8").replace("Hello", "Hi"));
    assert.equal((await history()).pending.length, 1);
    assert.equal((await s.send("POST", "/__inplace/suggestion/keep-all", page, "{}")).status, 200);
    assert.deepEqual((await history()).pending, []);
    assert.match(readFileSync(s.path, "utf8"), />Hi</);
  } finally {
    s.close();
  }
});

test("reading stays open at every level, and the access is looked up for each request", async () => {
  let level: "edit" | "comment" | "view" = "view";
  const s = await start({ access: () => level });
  try {
    const host = `localhost:${s.port}`;
    for (const path of ["/", "/__inplace/history", "/__inplace/comments", "/__inplace/stash"]) {
      assert.equal((await s.send("GET", path, { host })).status, 200, path);
    }
    const html = (await s.send("GET", "/", { host })).body;
    assert.match(html, /data-access="view"/);
    assert.match(html, /data-editable=""/);
    assert.match(html, /data-movable=""/);
    level = "edit";
    const editable = (await s.send("GET", "/", { host })).body;
    assert.match(editable, /data-access="edit"/);
    assert.match(editable, /data-editable="p-1"/);
  } finally {
    s.close();
  }
});

test("a path that isn't an action is not found, whatever the access", async () => {
  const s = await start({ access: () => "view" });
  try {
    const host = `localhost:${s.port}`;
    const page = { host, origin: `http://${host}`, "content-type": "application/json" };
    for (const path of ["/__inplace/constructor", "/__inplace/nothing", "/save"]) {
      assert.equal((await s.send("POST", path, page, "{}")).status, 404, path);
    }
  } finally {
    s.close();
  }
});
