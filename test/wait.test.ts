import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { ChangeFeed } from "../src/wait.js";

const CLI = resolve(import.meta.dirname, "..", "src", "cli.js");

// Numbered from 0 here; inplace numbers them from the time it started.
test("numbers the lines and answers straight away when a pause is already there", async () => {
  const feed = new ChangeFeed(500, 0);
  feed.add("16:34:18 edited p-1");
  assert.equal(feed.latest, 1);
  assert.equal(feed.take(0), null, "no pause yet");
  feed.add("16:34:23 paused after 1 change: edited p-1", true);
  feed.add("16:34:30 edited p-2");
  assert.deepEqual(await feed.wait(0), { next: 2, lines: ["16:34:18 edited p-1", "16:34:23 paused after 1 change: edited p-1"] });
  assert.equal(feed.delivered, 2);
  assert.equal(feed.take(2), null, "the line after the pause waits for the next one");
});

test("a wait resolves at the next pause, and with null after its timeout", async () => {
  const feed = new ChangeFeed(500, 0);
  const waiting = feed.wait(0, 5000);
  feed.add("edited p-1");
  feed.add("paused after 1 change", true);
  assert.deepEqual(await waiting, { next: 2, lines: ["edited p-1", "paused after 1 change"] });
  assert.equal(await feed.wait(2, 20), null);
  const stopped = new AbortController();
  const aborted = feed.wait(2, undefined, stopped.signal);
  stopped.abort();
  assert.equal(await aborted, null);
});

test("says so when older lines were dropped", () => {
  const feed = new ChangeFeed(2, 0);
  for (const line of ["a", "b", "c"]) feed.add(line);
  feed.add("paused", true);
  assert.deepEqual(feed.take(0)!.lines, ["(older changes are no longer kept here; read the document to catch up)", "c", "paused"]);
  assert.deepEqual(feed.take(2)!.lines, ["c", "paused"]);
});

test("a number from before inplace restarted gets everything since the restart, and says so", () => {
  const RESTARTED = "(inplace restarted since your last wait, so changes from before the restart may be missing; read the document to catch up)";
  const old = new ChangeFeed(500, 1000);
  old.add("edited p-1");
  old.add("paused after 1 change", true);
  const { next } = old.take(0)!;

  const feed = new ChangeFeed(500, 2000);
  feed.add("edited p-2");
  assert.equal(feed.take(next), null, "no pause yet");
  feed.add("paused after 1 change", true);
  assert.deepEqual(feed.take(next), { next: 2002, lines: [RESTARTED, "edited p-2", "paused after 1 change"] });
  feed.add("edited p-3");
  feed.add("paused after 1 change", true);
  assert.deepEqual(feed.take(next)!.lines, [RESTARTED, "edited p-2", "paused after 1 change", "edited p-3", "paused after 1 change"],
    "the first pause isn't skipped once the new feed has more lines than the old one");
  assert.equal(feed.take(9999)!.lines[0], RESTARTED, "a number this feed hasn't reached yet");
  assert.equal(feed.take(0)!.lines[0], "edited p-2", "0 means from the start, with nothing to say about it");
  assert.equal(feed.take(2002)!.lines[0], "edited p-3", "its own numbers carry on as usual");
});

function freePort(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

/** Run a CLI command to the end. */
function run(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((ok) => {
    const proc = spawn(process.execPath, [CLI, ...args]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("close", (code) => ok({ code: code ?? -1, out }));
  });
}

test("inplace wait returns each pause's lines once, and times out when nothing happens", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inplace-wait-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, '<html><body><p data-id="p-1">Ten trees</p></body></html>');
  const port = await freePort();
  const server = spawn(process.execPath, [CLI, path, "--port", String(port), "--pause", "0.3"], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    await new Promise<void>((ok) => server.stdout.on("data", (d) => String(d).includes("localhost") && ok()));
    const save = (old: string, next: string) => fetch(`http://localhost:${port}/__inplace/save`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "p-1", old, new: next }),
    });

    const waiting = run(["wait", "--port", String(port), "--timeout", "10"]);
    await new Promise((r) => setTimeout(r, 300));
    await save("Ten trees", "Twelve trees");
    const first = await waiting;
    assert.equal(first.code, 0);
    const reply = JSON.parse(first.out);
    assert.equal(reply.status, "pause");
    assert.equal(reply.lines.length, 2);
    assert.match(reply.lines[0], /edited p-1: "Ten trees" → "Twelve trees"/);
    assert.match(reply.lines[1], /paused after 1 change: edited p-1$/);

    // Passing next back doesn't repeat those lines: nothing new, so it times out.
    const idle = await run(["wait", "--port", String(port), "--timeout", "0.5", "--after", String(reply.next)]);
    assert.equal(idle.code, 3);
    assert.equal(JSON.parse(idle.out).status, "timeout");

    // A pause between two waits isn't missed.
    await save("Twelve trees", "Twelve oaks");
    await new Promise((r) => setTimeout(r, 700));
    const second = JSON.parse((await run(["wait", "--port", String(port), "--after", String(reply.next)])).out);
    assert.deepEqual(second.lines.map((l: string) => l.replace(/^\S+ /, "")),
      ['edited p-1: "Twelve trees" → "Twelve oaks"', "paused after 1 change: edited p-1"]);
    assert.equal(second.next, reply.next + 2);

    // Browsers can't hold waits open.
    const res = await fetch(`http://localhost:${port}/__inplace/wait?timeout=0`, { headers: { origin: "https://evil.example" } });
    assert.equal(res.status, 403);
  } finally {
    server.kill();
  }
});

test("inplace wait --after carries on after inplace restarts, from the restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inplace-restart-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, '<html><body><p data-id="p-1">Ten trees</p></body></html>');
  const port = await freePort();
  const start = async () => {
    const proc = spawn(process.execPath, [CLI, path, "--port", String(port), "--pause", "0.3"], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((ok) => proc.stdout.on("data", (d) => String(d).includes("localhost") && ok()));
    return proc;
  };
  const save = (old: string, next: string) => fetch(`http://localhost:${port}/__inplace/save`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "p-1", old, new: next }),
  });
  let server = await start();
  try {
    await save("Ten trees", "Twelve trees");
    const before = JSON.parse((await run(["wait", "--port", String(port), "--timeout", "5"])).out);
    assert.equal(before.status, "pause");

    server.kill();
    await new Promise((r) => server.on("close", r));
    server = await start();
    // The new inplace has as many lines as the old one had when the agent last waited.
    await save("Twelve trees", "Twelve oaks");
    await new Promise((r) => setTimeout(r, 700));
    const after = await run(["wait", "--port", String(port), "--timeout", "2", "--after", String(before.next)]);
    assert.equal(after.code, 0, "returns the pause instead of waiting for more lines than the old inplace had");
    const reply = JSON.parse(after.out);
    assert.match(reply.lines[0], /^\(inplace restarted since your last wait/);
    assert.deepEqual(reply.lines.slice(1).map((l: string) => l.replace(/^\S+ /, "")),
      ['edited p-1: "Twelve trees" → "Twelve oaks"', "paused after 1 change: edited p-1"]);

    // From then on, its next carries on as usual.
    await save("Twelve oaks", "Twelve limes");
    const third = JSON.parse((await run(["wait", "--port", String(port), "--timeout", "5", "--after", String(reply.next)])).out);
    assert.deepEqual(third.lines.map((l: string) => l.replace(/^\S+ /, "")),
      ['edited p-1: "Twelve oaks" → "Twelve limes"', "paused after 1 change: edited p-1"]);
  } finally {
    server.kill();
  }
});

test("inplace wait gives up when no server is running", async () => {
  const { code } = await run(["wait", "--port", String(await freePort()), "--timeout", "0.5"]);
  assert.equal(code, 1);
});

test("inplace comments lists the open comments and inplace resolve marks one done", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inplace-resolve-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, '<html><body><p data-id="p-1">Ten trees</p></body></html>');
  const port = await freePort();
  const server = spawn(process.execPath, [CLI, path, "--port", String(port)], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    await new Promise<void>((ok) => server.stdout.on("data", (d) => String(d).includes("localhost") && ok()));
    await fetch(`http://localhost:${port}/__inplace/comment`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", id: "p-1", text: "Name the trees." }),
    });
    const listed = await run(["comments", "--port", String(port)]);
    assert.equal(listed.code, 0);
    assert.deepEqual(JSON.parse(listed.out).map((c: { n: number; text: string }) => [c.n, c.text]), [[1, "Name the trees."]]);

    const resolved = await run(["resolve", "1", "--reply", "Oaks and limes.", "--port", String(port)]);
    assert.equal(resolved.code, 0);
    assert.equal(resolved.out, "Marked comment #1 as done.\n");
    assert.deepEqual(JSON.parse((await run(["comments", "--port", String(port)])).out), []);
    assert.equal(JSON.parse((await run(["comments", "--all", "--port", String(port)])).out)[0].reply, "Oaks and limes.");
    assert.equal((await run(["resolve", "9", "--port", String(port)])).code, 1);
  } finally {
    server.kill();
  }
});
