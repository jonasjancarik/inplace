// --- whether an agent is picking up your edits, as far as the server can tell ---
// The server sends { state, ago } on the "agent" event; ago is in seconds, as of when it arrived.
let agentStatus: AgentSummary | null = null;
let agentStatusAt = 0;
function agentStatusLine() {
  if (!agentStatus) return null;
  let text: string;
  if (agentStatus.state === "waiting") text = "Your agent is waiting for your next pause.";
  else if (agentStatus.state === "working") text = "Your agent picked up your last changes.";
  else if (agentStatus.state === "checked") {
    const s = agentStatus.ago + (Date.now() - agentStatusAt) / 1000;
    const when = s < 45 ? "just now" : s < 90 ? "a minute ago" : s < 3600 ? `${Math.round(s / 60)} minutes ago`
      : `at ${new Date(Date.now() - s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    text = `Your agent last checked your changes ${when}.`;
  } else if (agentStatus.state === "none") text = "No agent has checked your changes yet. Ask your agent to pick up your edits.";
  // Agents reading the terminal output or a log file can't be seen, so don't say anything about them.
  else text = "If your agent doesn't react to your edits, ask it to check them.";
  return make("p", { className: "agent-status", textContent: text });
}
function showAgentStatus(data: string) {
  try { agentStatus = JSON.parse(data); } catch { return; }
  agentStatusAt = Date.now();
  if (changesPanel.classList.contains("open")) renderChanges();
}
