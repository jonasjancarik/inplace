// --- who wrote what: a thin bar in the margin of each block, coloured by its last author ---
// Off until the user turns it on in the list of changes; the choice is kept for this document.
const AUTHORS_FLAG = `${STATE_KEY}:show-authors`;
let showAuthors = false;
try { showAuthors = localStorage.getItem(AUTHORS_FLAG) === "1"; } catch {}
const authorLayer = make("div", { id: "inplace-authors-layer" });
authorLayer.dataset.inplaceUi = "";

const AGENT_COLOUR = "#4a7bd4";
const PEOPLE_COLOURS = ["#3f8f5c", "#c2761f", "#8a5cc7", "#c24a7a", "#2f8f9a"];

// This person is green; other people take the next colours in the order they first appear.
function colourOf(a: Author) {
  if (a.kind === "agent") return AGENT_COLOUR;
  if (isMe(a)) return PEOPLE_COLOURS[0];
  const others = [...new Set(Object.values(authorMarks).flatMap((m) => [m.by, m.addedBy]).filter((x): x is Author => !!x && x.kind === "person" && !isMe(x)).map((x) => x.id ?? x.name))];
  return PEOPLE_COLOURS[1 + (Math.max(0, others.indexOf(a.id ?? a.name)) % (PEOPLE_COLOURS.length - 1))];
}

function sinceWords(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 45) return "just now";
  if (s < 90) return "a minute ago";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 5400) return "an hour ago";
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  if (s < 172800) return "yesterday";
  return `${Math.round(s / 86400)} days ago`;
}

// "Your agent changed this 20 minutes ago", or "Added by Jana, changed by you yesterday".
function authorSentence(m: AuthorMark) {
  const last = byWords(m.by);
  const when = sinceWords(m.at);
  return m.addedBy && !sameAuthor(m.addedBy, m.by)
    ? `Added by ${byWords(m.addedBy)}, changed by ${last} ${when}`
    : `${capital(last)} changed this ${when}`;
}
const sameAuthor = (a: Author, b: Author) => a.kind === b.kind && a.id === b.id && (a.id !== undefined || isMe(a) === isMe(b));

function paintAuthors() {
  authorLayer.replaceChildren();
  if (!showAuthors || !Object.keys(authorMarks).length) return authorLayer.remove();
  if (!authorLayer.isConnected) document.body.append(authorLayer);
  for (const [id, mark] of Object.entries(authorMarks)) {
    const el = byId(id);
    if (!el || !isShown(el)) continue;
    const r = el.getBoundingClientRect();
    if (!r.height) continue;
    // Blocks inside blocks (a list item in a list) step outwards so their bars don't sit on top of each other.
    let depth = 0;
    for (let p = el.parentElement?.closest("[data-id]"); p && depth < 3; p = p.parentElement?.closest("[data-id]")) depth++;
    const bar = make("div", { className: "bar", title: authorSentence(mark) });
    bar.style.cssText = `left:${Math.max(0, r.left + scrollX - 12 - depth * 6)}px;top:${r.top + scrollY}px;height:${r.height}px;--by:${colourOf(mark.by)}`;
    bar.addEventListener("pointerenter", () => { bar.title = authorSentence(mark); });
    authorLayer.append(bar);
  }
}

function authorsSwitch() {
  return make("label", { className: "authors-switch" },
    make("input", { type: "checkbox", role: "switch", checked: showAuthors, onchange: (e) => {
      showAuthors = (e.target as HTMLInputElement).checked;
      try { localStorage.setItem(AUTHORS_FLAG, showAuthors ? "1" : "0"); } catch {}
      paintAuthors();
    } }),
    "Show who wrote what");
}

let authorsFrame = 0;
const repaintAuthors = () => { cancelAnimationFrame(authorsFrame); authorsFrame = requestAnimationFrame(paintAuthors); };
addEventListener("resize", repaintAuthors);
addEventListener("load", repaintAuthors);
if (typeof ResizeObserver === "function") new ResizeObserver(repaintAuthors).observe(document.documentElement);
