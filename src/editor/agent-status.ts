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
  showSeen(agentStatus!.seen ?? []);
  if (changesPanel.classList.contains("open")) renderChanges();
}

// --- a mark beside each block the agent has picked up: an eye, then a check that fades ---
// They sit in a layer of their own, never inside a block, so they can't end up in the file.
const seenLayer = make("div", { id: "inplace-seen-layer" });
seenLayer.dataset.inplaceUi = "";
document.body.append(seenLayer);
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
// How long a mark that fades stays up; "picked" stays until the agent is done.
const SEEN_SHOWN_MS = { sent: 6000, done: 2500 };
type SeenMarker = HTMLSpanElement & { inplaceTarget: Element };
let seenTimers: number[] = [];

function fadeSeen(marker: Element) {
  if (marker.classList.contains("fading")) return;
  marker.classList.add("fading");
  setTimeout(() => marker.remove(), matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450);
}

function showSeen(seen: SeenPause[]) {
  for (const t of seenTimers) clearTimeout(t);
  seenTimers = [];
  // A later pause's mark wins for a block that's in two.
  const marks = new Map<string, SeenPause>();
  for (const p of seen) for (const id of p.ids) marks.set(id, p);
  const shown = new Map<string, SeenMarker>();
  for (const m of seenLayer.children as HTMLCollectionOf<SeenMarker>) if (!m.classList.contains("fading")) shown.set(m.dataset.for!, m);
  for (const [id, m] of shown) if (!marks.has(id)) fadeSeen(m);
  for (const [id, p] of marks) {
    const el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
    const left = p.mark === "picked" ? Infinity : SEEN_SHOWN_MS[p.mark] - p.age;
    let marker = shown.get(id);
    if (!el || left <= 0) {
      if (marker) fadeSeen(marker);
      continue;
    }
    if (!marker) {
      marker = make("span", { className: "seen new" }) as SeenMarker;
      marker.dataset.for = id;
      marker.setAttribute("role", "img");
      seenLayer.append(marker);
      requestAnimationFrame(() => requestAnimationFrame(() => marker!.classList.remove("new")));
    }
    marker.inplaceTarget = el;
    if (marker.dataset.mark !== p.mark) {
      marker.dataset.mark = p.mark;
      marker.innerHTML = p.mark === "done" ? CHECK : EYE;
      marker.title = p.mark === "done" ? "Your agent checked this change." : "Your agent picked up this change.";
      marker.setAttribute("aria-label", marker.title);
    }
    if (left !== Infinity) seenTimers.push(setTimeout(() => fadeSeen(marker!), left));
  }
  positionSeen();
}

// At the block's top right corner, next to its comment marker if it has one.
function positionSeen() {
  const commented = new Map<Element, Element>();
  for (const c of document.querySelectorAll<HTMLElement & { inplaceTarget?: Element }>("#inplace-comment-layer .marker"))
    if (c.inplaceTarget) commented.set(c.inplaceTarget, c);
  for (const marker of seenLayer.children as HTMLCollectionOf<SeenMarker>) {
    const r = marker.inplaceTarget.getBoundingClientRect();
    const hidden = !marker.inplaceTarget.isConnected || r.bottom < 0 || r.top > innerHeight || (!r.width && !r.height);
    marker.style.display = hidden ? "none" : "";
    const beside = commented.get(marker.inplaceTarget)?.getBoundingClientRect().width;
    marker.style.left = `${Math.min(innerWidth - 24, r.right + 4 + (beside ? beside + 4 : 0))}px`;
    marker.style.top = `${Math.max(4, r.top - 2)}px`;
  }
}
let seenFrame = 0;
const moveSeen = () => {
  if (!seenFrame && seenLayer.children.length) seenFrame = requestAnimationFrame(() => { seenFrame = 0; positionSeen(); });
};
addEventListener("scroll", moveSeen, { passive: true, capture: true });
addEventListener("resize", moveSeen);
document.addEventListener("input", moveSeen);
