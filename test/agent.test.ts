import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { get, type IncomingMessage } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { agentState, AgentStatus, WORKING_MS, type AgentSignals } from "../src/agent.js";
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

/** The `agent` events on the page's event stream, as they arrive. */
function agentEvents(port: number) {
  const seen: { state: string; ago?: number }[] = [];
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
  return { until, close: () => res?.destroy() };
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
