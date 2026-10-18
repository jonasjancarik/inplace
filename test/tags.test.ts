import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { type CommentTag, CommentStore, type TagRequest } from "../src/comments.js";
import { PauseWatcher } from "../src/idle.js";
import { Document } from "../src/server.js";
import { jevTagger } from "../src/tags.js";

const store = (log: (line: string) => void = () => {}) =>
  new CommentStore(join(mkdtempSync(join(tmpdir(), "inplace-tags-")), "comments.json"), log);
/** A tagger that answers when the test says so. */
function controlled() {
  const asked: { text: string; answer: (tag: CommentTag | undefined) => void }[] = [];
  const tagger = (c: { text: string }) => new Promise<CommentTag | undefined>((answer) => asked.push({ text: c.text, answer }));
  return { asked, tagger };
}
const settle = () => new Promise((ok) => setImmediate(ok));

test("without a tagger, comments have no tag", () => {
  const comments = store();
  const added = comments.add({ id: "p-1", text: "Typo: recieve" });
  assert.equal(added.tag, undefined);
  assert.equal(comments.withTag("comment #1"), "comment #1");
});

test("the change line goes out before the tagger answers, and the tag is saved when it does", async () => {
  const lines: string[] = [];
  const comments = store((line) => lines.push(line));
  const { asked, tagger } = controlled();
  comments.tagger = tagger;
  const added = comments.add({ id: "p-1", text: "Typo: recieve" });
  assert.equal(lines.length, 1, "logged straight away");
  assert.equal(added.tag, undefined);
  const before = comments.revision;
  asked[0].answer("small fix");
  await settle();
  assert.equal(comments.get(1).tag, "small fix");
  assert.ok(comments.revision > before, "saving the tag tells the page");
  assert.equal(comments.withTag("comment #1"), "comment #1 (small fix)");
  assert.equal(lines.length, 1, "a tag adds no change line");
});

test("a failing or unsure tagger leaves the comment untagged", async () => {
  const comments = store();
  comments.tagger = () => Promise.reject(new Error("down"));
  comments.add({ id: "p-1", text: "One" });
  comments.tagger = () => Promise.resolve(undefined);
  comments.add({ id: "p-1", text: "Two" });
  await settle();
  assert.deepEqual(comments.list().map((c) => c.tag), [undefined, undefined]);
});

test("an edit drops the old tag and asks again; an answer about the old text is ignored", async () => {
  const comments = store();
  const { asked, tagger } = controlled();
  comments.tagger = tagger;
  comments.add({ id: "p-1", text: "Typo: recieve" });
  comments.edit(1, "Actually, rewrite this whole paragraph");
  asked[0].answer("small fix");
  await settle();
  assert.equal(comments.get(1).tag, undefined);
  assert.equal(asked[1].text, "Actually, rewrite this whole paragraph");
  asked[1].answer("rewrite");
  await settle();
  assert.equal(comments.get(1).tag, "rewrite");
});

test("the agent's own comments and deleted comments aren't tagged", async () => {
  const comments = store();
  const { asked, tagger } = controlled();
  comments.tagger = tagger;
  comments.add({ id: "p-1", text: "Shall I fix this?", by: "agent" });
  assert.equal(asked.length, 0);
  comments.add({ id: "p-1", text: "Typo" });
  comments.delete(2);
  asked[0].answer("small fix");
  await settle();
  assert.deepEqual(comments.list().map((c) => c.n), [1]);
});

test("Document.useTagger sends the comment, its quote and the element's text, not the whole document", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inplace-tags-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, "<html><body><h1>Secret plan</h1><p>We recieve the beds in May.</p></body></html>");
  const doc = new Document(path, true, () => {}, dir);
  const requests: TagRequest[] = [];
  doc.useTagger(async (request) => (requests.push(request), "small fix"));
  doc.comments.add({ id: "p-1", text: "Spelling", quote: "recieve", prefix: "We ", suffix: " the" });
  await settle();
  assert.deepEqual(requests, [{ text: "Spelling", quote: "recieve", element: "We recieve the beds in May." }]);
  assert.equal(doc.comments.get(1).tag, "small fix");
});

test("the pause summary shows tags through describe", () => {
  const pauses: string[] = [];
  const watcher = new PauseWatcher(0, (summary) => pauses.push(summary), (label) => (label === "comment #3" ? `${label} (question)` : label));
  watcher.record("16:41:02 comment #3 on p-7: \"Why May?\"");
  watcher.record("16:41:05 edited p-1: \"a\" → \"b\"");
  return new Promise<void>((ok) => setTimeout(() => {
    assert.match(pauses[0], /paused after 2 changes: comment #3 \(question\), edited p-1$/);
    ok();
  }, 5));
});

/** A fake fetch that records requests and answers with `reply`. */
function fakeFetch(reply: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => (calls.push({ url, init }), reply())) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}
const jevAnswer = (choice: string, confidence: number) =>
  new Response(JSON.stringify({ model: "jev-1.13.0", answers: { kind: { type: "choice", choice, probabilities: {}, confidence } } }));

test("jevTagger asks Jev and maps its choice to a tag when it's sure enough", async () => {
  const { calls, fetch } = fakeFetch(() => jevAnswer("small_fix", 0.95));
  const tag = await jevTagger("k-123", { fetch })({ text: "Spelling", quote: "recieve", element: "We recieve the beds." });
  assert.equal(tag, "small fix");
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer k-123");
  const body = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(body.state, { comment: "Spelling", selected_text: "recieve", element_text: "We recieve the beds." });
  assert.equal(body.questions.kind.type, "choice");
  assert.deepEqual(Object.keys(body.questions.kind.criteria), ["small_fix", "rewrite", "content", "question", "layout"]);

  const fairlySure = fakeFetch(() => jevAnswer("question", 0.82));
  assert.equal(await jevTagger("k", { fetch: fairlySure.fetch })({ text: "Why May?", element: "" }), "question");
  const unsure = fakeFetch(() => jevAnswer("rewrite", 0.79));
  assert.equal(await jevTagger("k", { fetch: unsure.fetch })({ text: "Hmm", element: "" }), undefined);
});

test("jevTagger cuts long elements", async () => {
  const { calls, fetch } = fakeFetch(() => jevAnswer("content", 0.99));
  await jevTagger("k", { fetch })({ text: "Check this", element: "x".repeat(10_000) });
  assert.equal(JSON.parse(calls[0].init.body as string).state.element_text.length, 2000);
});

test("jevTagger gives up quietly on errors and timeouts, warning once", async () => {
  const warnings: string[] = [];
  const rejected = fakeFetch(() => new Response("{}", { status: 401 }));
  const tag = jevTagger("bad", { fetch: rejected.fetch, warn: (m) => warnings.push(m) });
  assert.equal(await tag({ text: "One", element: "" }), undefined);
  assert.equal(await tag({ text: "Two", element: "" }), undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /HTTP 401, check INPLACE_JEV_KEY/);

  const slow = fakeFetch(() => new Promise<Response>(() => {}));
  const hanging = (async (_url: string, init: RequestInit) => {
    await new Promise((_, fail) => init.signal!.addEventListener("abort", () => fail(init.signal!.reason)));
    return slow.fetch("", init);
  }) as unknown as typeof globalThis.fetch;
  const timeoutWarnings: string[] = [];
  const started = Date.now();
  assert.equal(await jevTagger("k", { fetch: hanging, timeoutMs: 50, warn: (m) => timeoutWarnings.push(m) })({ text: "x", element: "" }), undefined);
  assert.ok(Date.now() - started < 1000);
  assert.match(timeoutWarnings[0], /no answer within 50 ms/);

  const garbled = fakeFetch(() => jevAnswer("something_else", 0.99));
  assert.equal(await jevTagger("k", { fetch: garbled.fetch, warn: () => {} })({ text: "x", element: "" }), undefined);
});

const CLI = resolve(import.meta.dirname, "..", "src", "cli.js");

/** Start inplace on a scratch file and return what it prints before it starts listing changes. */
function startup(env: Record<string, string | undefined>, args: string[] = []): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "inplace-tags-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, "<p>Hi</p>");
  const { INPLACE_JEV_KEY: _, ...rest } = process.env;
  const proc = spawn(process.execPath, [CLI, path, "--port", "0", "--pause", "0", ...args], { env: { ...rest, ...env }, stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((ok) => {
    let out = "";
    proc.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.includes("Changes made on the page")) (proc.kill(), ok(out));
    });
  });
}

test("comments are tagged only when INPLACE_JEV_KEY is set, and never with --no-tags", async () => {
  const notice = /tagged by Jev/;
  assert.doesNotMatch(await startup({}), notice);
  assert.doesNotMatch(await startup({ INPLACE_JEV_KEY: "  " }), notice);
  assert.doesNotMatch(await startup({ INPLACE_JEV_KEY: "k-123" }, ["--no-tags"]), notice);
  assert.match(await startup({ INPLACE_JEV_KEY: "k-123" }), notice);
});
