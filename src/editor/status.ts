const pill = document.createElement("div");
pill.id = "inplace-status";
pill.dataset.inplaceUi = "";
document.body.append(pill);
let pillTimer: number | undefined;
// `sticky` keeps the message up; a number keeps it up for that many ms.
function showStatus(text: string, kind: "info" | "error" = "info", sticky: boolean | number = false) {
  pill.textContent = text;
  pill.dataset.kind = kind;
  delete pill.dataset.owner;
  pill.style.display = "";
  clearTimeout(pillTimer);
  if (sticky !== true) pillTimer = setTimeout(() => (pill.style.display = "none"), sticky || 2500);
}
pill.style.display = "none";
