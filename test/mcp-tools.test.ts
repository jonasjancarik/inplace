import assert from "node:assert/strict";
import { test } from "node:test";

import { DocumentTools } from "../src/mcp-tools.js";
import { hostDocument } from "./host-document.js";

test("each client gets every change from get_edits, whichever order they ask in", () => {
  const target = hostDocument();
  const tools = new DocumentTools(target);
  target.doc.saveBlock("p-1", "Ten trees", "Twelve trees");
  assert.match(tools.call("get_edits", {}, "a") as string, /Twelve trees/);
  assert.equal(tools.call("get_edits", {}, "a"), "No changes since the last call.");
  assert.match(tools.call("get_edits", {}, "b") as string, /Twelve trees/, "b hasn't seen it yet");
  target.doc.saveBlock("p-2", "Two benches", "Three benches");
  assert.match(tools.call("get_edits", {}, "b") as string, /Three benches/);
  assert.match(tools.call("get_edits", {}, "a") as string, /Three benches/);
});

test("two clients waiting on one document are both woken by the pause", async () => {
  const target = hostDocument();
  const tools = new DocumentTools(target);
  const a = tools.call("wait_for_edits", { timeout_seconds: 5 }, "a") as Promise<string>;
  const b = tools.call("wait_for_edits", { timeout_seconds: 5 }, "b") as Promise<string>;
  target.doc.saveBlock("p-1", "Ten trees", "Twelve trees");
  for (const text of await Promise.all([a, b])) assert.match(text, /Twelve trees[\s\S]*paused after/);
  // Having waited, neither is told about the same change again.
  assert.equal(tools.call("get_edits", {}, "a"), "No changes since the last call.");
  assert.equal(tools.call("get_edits", {}, "b"), "No changes since the last call.");
});

test("with join: now, a client sees only what changes after its first call", () => {
  const target = hostDocument();
  const tools = new DocumentTools(target, { join: "now" });
  target.doc.saveBlock("p-1", "Ten trees", "Twelve trees");
  assert.equal(tools.call("get_edits", {}, "a"), "No changes since the last call.");
  target.doc.saveBlock("p-2", "Two benches", "Three benches");
  const text = tools.call("get_edits", {}, "a") as string;
  assert.match(text, /Three benches/);
  assert.doesNotMatch(text, /Twelve trees/);
});
