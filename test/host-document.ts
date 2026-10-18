import { AgentStatus, ChangeFeed, Document, MemoryStore, PauseWatcher } from "../src/index.js";

export const PAGE = '<html><body><p data-id="p-1">Ten trees</p><p data-id="p-2">Two benches</p></body></html>';

/** A document the way a host holds it: in memory, with its change lines and pauses going to a feed. */
export function hostDocument(pauseMs = 40) {
  const feed = new ChangeFeed();
  const agent = new AgentStatus();
  const pauses = new PauseWatcher(pauseMs, (summary) => feed.add(summary, true));
  const doc = new Document(new MemoryStore("report.html", PAGE), true, (line, byUser) => {
    feed.add(line);
    if (byUser) pauses.record(line);
  });
  return { doc, feed, agent, name: "report.html", url: "https://docs.example.com/d/1" };
}
