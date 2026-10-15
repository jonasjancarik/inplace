import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";

import { PauseCommand, PauseWatcher } from "../src/idle.js";

test("sums up a burst of changes once the user pauses", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const pauses: { summary: string; lines: string[] }[] = [];
    const watcher = new PauseWatcher(5000, (summary, lines) => pauses.push({ summary, lines }));
    watcher.record(`16:34:18 edited p-1: "a" → "ab"`);
    mock.timers.tick(3000);
    watcher.record(`16:34:21 edited p-1: "ab" → "abc"`);
    watcher.record(`16:34:22 added tr-3 <tr> after tr-2: "Rain barrel"`);
    mock.timers.tick(4999);
    assert.equal(pauses.length, 0, "keeps waiting while changes keep coming");
    mock.timers.tick(1);
    assert.equal(pauses.length, 1);
    assert.match(pauses[0].summary, /^\d\d:\d\d:\d\d paused after 3 changes: edited p-1, added tr-3$/);
    assert.equal(pauses[0].lines.length, 3);

    watcher.record("16:40:00 removed tr-7, which the user had emptied");
    mock.timers.tick(5000);
    assert.match(pauses[1].summary, /paused after 1 change: removed tr-7$/);
    assert.deepEqual(pauses[1].lines, ["16:40:00 removed tr-7, which the user had emptied"]);
  } finally {
    mock.timers.reset();
  }
});

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check(), "timed out");
};

test("runs the pause command with the changes on stdin, one run at a time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inplace-pause-"));
  const out = join(dir, "runs.txt");
  const logged: string[] = [];
  // Each run appends its stdin and a separator, then waits a little so the next pause arrives mid-run.
  const command = new PauseCommand(`cat >> "${out}"; echo --- >> "${out}"; echo "file: $INPLACE_FILE"; sleep 0.2`,
    { INPLACE_FILE: "/docs/report.html" }, (line) => logged.push(line));
  command.run(["edited p-1"]);
  command.run(["edited p-2"]);
  command.run(["added tr-3"]);
  await waitFor(() => logged.length === 2);
  assert.equal(readFileSync(out, "utf8"), "edited p-1\n---\nedited p-2\nadded tr-3\n---\n");
  assert.deepEqual(logged, ["  on-pause: file: /docs/report.html", "  on-pause: file: /docs/report.html"]);
});

test("reports a failing pause command", async () => {
  const logged: string[] = [];
  const command = new PauseCommand("exit 3", {}, (line) => logged.push(line));
  command.run(["edited p-1"]);
  await waitFor(() => logged.length === 1);
  assert.deepEqual(logged, ["  on-pause: the command exited with code 3"]);
});
