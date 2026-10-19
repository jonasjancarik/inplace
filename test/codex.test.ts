import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { addInplaceHook, codexHookHint, codexHooksPath, hasInplaceHook, hookCommand, startedByCodex } from "../src/codex.js";

const tempHome = () => mkdtempSync(join(tmpdir(), "inplace-codex-"));

test("adds the hook beside the hooks already there, backs the file up, and adds it only once", () => {
  const home = tempHome();
  const path = codexHooksPath({ CODEX_HOME: home });
  const theirs = { hooks: { Stop: [{ hooks: [{ type: "command", command: "their-stop-hook" }] }], PostToolUse: [{ matcher: "^Bash$", hooks: [{ type: "command", command: "lint" }] }] } };
  writeFileSync(path, JSON.stringify(theirs));

  const first = addInplaceHook(path);
  assert.equal(first.result, "added");
  assert.deepEqual(JSON.parse(readFileSync(first.backup!, "utf8")), theirs, "the backup is the file as it was");
  const after = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(after.hooks.Stop, theirs.hooks.Stop);
  assert.deepEqual(after.hooks.PostToolUse[0], theirs.hooks.PostToolUse[0]);
  assert.deepEqual(after.hooks.PostToolUse[1], { matcher: ".*", hooks: [{ type: "command", command: hookCommand(), timeout: 5 }] });
  assert.ok(hasInplaceHook(path));

  assert.deepEqual(addInplaceHook(path), { result: "present" });
  assert.equal(readdirSync(home).filter((f) => f.includes(".bak-")).length, 1, "no second backup");

  // Another port is another hook.
  assert.equal(hasInplaceHook(path, 8800), false);
  const second = addInplaceHook(path, 8800);
  assert.equal(second.result, "added");
  assert.notEqual(second.backup, first.backup, "a backup made in the same second doesn't replace the first");
  assert.deepEqual(JSON.parse(readFileSync(first.backup!, "utf8")), theirs);
  assert.match(JSON.parse(readFileSync(path, "utf8")).hooks.PostToolUse[2].hooks[0].command, /localhost:8800\//);
});

test("creates the file when there's none, and leaves one it can't read alone", () => {
  const home = join(tempHome(), "not-yet");
  const path = codexHooksPath({ CODEX_HOME: home });
  assert.deepEqual(addInplaceHook(path), { result: "added" });
  assert.ok(hasInplaceHook(path));

  const broken = join(tempHome(), "hooks.json");
  writeFileSync(broken, "{ not json");
  assert.throws(() => addInplaceHook(broken), /isn't a JSON object/);
  assert.equal(readFileSync(broken, "utf8"), "{ not json");
});

test("hints at the setup only when Codex started inplace and the hook is missing", () => {
  const home = tempHome();
  assert.equal(startedByCodex({}), false);
  assert.equal(startedByCodex({}, "codex-mcp-client"), true);
  assert.equal(codexHookHint(8765, { CODEX_HOME: home }), undefined, "not Codex");
  assert.match(codexHookHint(8765, { CODEX_HOME: home, CODEX_THREAD_ID: "t" })!, /`npx -y github:jonasjancarik\/inplace setup codex`/);
  assert.match(codexHookHint(8800, { CODEX_HOME: home }, "codex-mcp-client")!, /setup codex --port 8800`/);
  addInplaceHook(codexHooksPath({ CODEX_HOME: home }));
  assert.equal(codexHookHint(8765, { CODEX_HOME: home, CODEX_THREAD_ID: "t" }), undefined, "already set up");
});
