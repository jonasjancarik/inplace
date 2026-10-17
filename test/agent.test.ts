import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { get, type IncomingMessage } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { agentState, AgentStatus, FADING_MARK_MS, WORKING_MS, type AgentSignals } from "../src/agent.js";
import { PauseWatcher } from "../src/idle.js";
import { createInplaceServer, Document } from "../src/server.js";
import { ChangeFeed } from "../src/wait.js";

const quiet: AgentSignals = { waits: 0, channel: false, commandRunning: false, unseenReaders: false };

test("turns what inplace has seen into one state", () => {
  const now = 10_000_000;
  assert.deepEqual(agentState(quiet, now), { state: "none" });
  // Only stdout or a log file: someone may be reading, so claim nothing.
  assert.deepEqual(agentState({ ...quiet, unseenReaders: true }, now), { state: "unknown" });
  assert.deepEqual(agentState({ ...quiet, waits: 1 }, now), { state: "waiting" });
  assert.deepEqual(agentState({ ...quiet, channel: true }, now), { state: "waiting" });
  assert.deepEqual(agentState({ ...quiet, unseenReaders: true, lastCheck: now - 720_000 }, now), { state: "checked", ago: 720 });
  assert.deepEqual(agentState({ ...quiet, commandRunning: true }, now), { state: "working" });

  const delivered = { ...quiet, channel: true, lastCheck: now - 1000, lastDelivery: now - 1000, lastAgentAction: now - 5000 };
  assert.deepEqual(agentState(delivered, now), { state: "working" });
  assert.deepEqual(agentState({ ...delivered, lastAgentAction: now }, now), { state: "waiting" }, "the agent wrote since");
  assert.deepEqual(agentState(delivered, now + WORKING_MS), { state: "waiting" }, "working runs out");
});

/** Each pause's mark as the page gets it, without its age. */
const marks = (status: AgentStatus, now?: number) => status.summary(now).seen.map(({ ids, mark }) => ({ ids, mark }));

test("a wait shows when the agent picked up a pause and, with its next wait, when it was done", () => {
  const status = new AgentStatus();
  status.edited(["p-1"]);
  status.edited(["p-2", "p-1"]);
  status.paused();
  assert.deepEqual(marks(status), [], "nothing until the agent gets the pause");
  status.waitStarted();
  status.waitEnded(true);
  assert.deepEqual(marks(status), [{ ids: ["p-1", "p-2"], mark: "picked" }]);
  status.waitStarted();
  assert.deepEqual(marks(status), [{ ids: ["p-1", "p-2"], mark: "done" }]);
  assert.deepEqual(marks(status, Date.now() + FADING_MARK_MS), [], "the check fades");
});

test("--on-pause shows picked up while the command runs and done when it exits", () => {
  const status = new AgentStatus();
  status.edited(["p-1"]);
  status.paused();
  status.commandRunning(true);
  assert.deepEqual(marks(status), [{ ids: ["p-1"], mark: "picked" }]);
  // A pause while it runs waits for the next run, which starts once this one has finished.
  status.edited(["p-2"]);
  status.paused();
  status.commandRunning(true);
  assert.deepEqual(marks(status), [{ ids: ["p-1"], mark: "done" }, { ids: ["p-2"], mark: "picked" }]);
  status.commandRunning(false);
  assert.deepEqual(marks(status), [{ ids: ["p-1"], mark: "done" }, { ids: ["p-2"], mark: "done" }]);
});

test("a channel event or get_edits shows only that the pause was sent, and a reader inplace can't see shows nothing", () => {
  const channel = new AgentStatus({ channel: true });
  channel.edited(["p-1"]);
  channel.paused();
  channel.sentToChannel();
  channel.waitStarted();
  assert.deepEqual(marks(channel), [{ ids: ["p-1"], mark: "sent" }], "never a check without the agent finishing");

  const pull = new AgentStatus();
  pull.edited(["p-1"]);
  pull.paused();
  pull.pulled();
  assert.deepEqual(marks(pull), [{ ids: ["p-1"], mark: "sent" }]);

  const stdout = new AgentStatus({ unseenReaders: true });
  stdout.edited(["p-1"]);
  stdout.paused();
  stdout.sentToChannel(); // not a channel client: nothing was sent
  assert.deepEqual(marks(stdout), []);
});

test("a block edited again loses its mark, and an eye runs out without turning into a check", () => {
  const status = new AgentStatus();
  status.edited(["p-1", "p-2"]);
  status.paused();
  status.waitEnded(true);
  status.edited(["p-2"]);
  assert.deepEqual(marks(status), [{ ids: ["p-1"], mark: "picked" }]);
  assert.deepEqual(marks(status, Date.now() + WORKING_MS), []);
});

/** The `agent` events on the page's event stream, as they arrive. */
function agentEvents(port: number) {
  const seen: { state: string; ago?: number; seen?: { ids: string[]; mark: string }[] }[] = [];
  let res: IncomingMessage | undefined;
  get({ host: "127.0.0.1", port, path: "/__inplace/events", headers: { host: `localhost:${port}` } }, (r) => {
    res = r;
    let buffer = "";
    r.setEncoding("utf8");
    r.on("data", (d: string) => {
      buffer += d;
      for (let at = buffer.indexOf("\n\n"); at !== -1; at = buffer.indexOf("\n\n")) {
        const event = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const data = /^event: agent\ndata: (.*)$/m.exec(event);
        if (data) seen.push(JSON.parse(data[1]));
      }
    });
  });
  const until = async (state: string) => {
    for (let i = 0; i < 300 && seen.at(-1)?.state !== state; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(seen.at(-1)?.state, state, JSON.stringify(seen));
  };
  /** Until the latest event marks these blocks. */
  const untilMarked = async (mark: string, ids: string[]) => {
    const has = () => seen.at(-1)?.seen?.some((p) => p.mark === mark && p.ids.join() === ids.join());
    for (let i = 0; i < 300 && !has(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(has(), JSON.stringify(seen.at(-1)));
  };
  return { until, untilMarked, close: () => res?.destroy() };
}

test("the page hears when a wait is open, when a pause is handed over, and when the agent writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inplace-agent-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, '<html><body><p data-id="p-1">Ten trees</p></body></html>');
  const feed = new ChangeFeed();
  const pauses = new PauseWatcher(100, (summary) => feed.add(summary, true));
  const doc = new Document(path, true, (line, byUser) => {
    feed.add(line);
    if (byUser) pauses.record(line);
  }, dir);
  const server = createInplaceServer(doc, { feed, agent: new AgentStatus({ unseenReaders: true }) });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  const events = agentEvents(port);
  try {
    await events.until("unknown");
    const waiting = new Promise((ok) =>
      get({ host: "127.0.0.1", port, path: "/__inplace/wait", headers: { host: `localhost:${port}` } }, (r) => r.resume().on("end", ok)));
    await events.until("waiting");

    doc.saveBlock("p-1", "Ten trees", "Twelve trees");
    await waiting;
    await events.until("working");

    writeFileSync(path, '<html><body><p data-id="p-1">Twelve trees</p><p>Total: 12</p></body></html>');
    doc.poll();
    await events.until("checked");
  } finally {
    events.close();
    server.closeAllConnections();
    server.close();
  }
});

test("the page gets the edited blocks marked when a wait picks up the pause, and checked at the next wait", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inplace-agent-"));
  const path = join(dir, "doc.html");
  writeFileSync(path, '<html><body><p data-id="p-1">Ten trees</p><p data-id="p-2">Two benches</p></body></html>');
  const feed = new ChangeFeed();
  const agent = new AgentStatus({ unseenReaders: true });
  const pauses = new PauseWatcher(100, (summary) => {
    agent.paused();
    feed.add(summary, true);
  });
  const doc = new Document(path, true, (line, byUser, ids = []) => {
    feed.add(line);
    if (byUser) {
      agent.edited(ids);
      pauses.record(line);
    }
  }, dir);
  const server = createInplaceServer(doc, { feed, agent });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  const events = agentEvents(port);
  const wait = () => new Promise((ok) =>
    get({ host: "127.0.0.1", port, path: "/__inplace/wait", headers: { host: `localhost:${port}` } }, (r) => r.resume().on("end", ok)));
  try {
    await events.until("unknown");
    const first = wait();
    await events.until("waiting");
    doc.saveBlock("p-1", "Ten trees", "Twelve trees");
    await first;
    await events.untilMarked("picked", ["p-1"]);
    const next = wait();
    await events.untilMarked("done", ["p-1"]);
    doc.saveBlock("p-2", "Two benches", "Three benches");
    await next;
    await events.untilMarked("picked", ["p-2"]);
  } finally {
    events.close();
    server.closeAllConnections();
    server.close();
  }
});
