// Times like "2 minutes ago" stay current while the list is open.
setInterval(() => { if (changesPanel.classList.contains("open")) renderChanges(); }, 30_000);
if (reopenChanges) openChanges();
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeStash(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.classList.contains("open")) closeStash(); });

const events = new EventSource("/__inplace/events");
events.addEventListener("stash", (e) => showStashCount(Number(e.data)));
events.addEventListener("agent", (e) => showAgentStatus(e.data));
events.addEventListener("comments", () => loadComments());
events.addEventListener("history", (e) => {
  if (Number(e.data) > 0) return loadHistory();
  if (seenChanges === null) markChangesSeen();
});
events.addEventListener("version", (e) => {
  if (busy) announced = e.data;
  else if (e.data !== version) reload();
});
events.onerror = () => showStatus("Lost connection to the editor server. Reconnecting…", "error", true);
events.onopen = () => { if (pill.dataset.kind === "error" && pill.textContent.startsWith("Lost")) showStatus("Reconnected"); };
