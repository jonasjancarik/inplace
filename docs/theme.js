// Theme switch: light, system or dark (remembered per browser when storage is available)
const root = document.documentElement, themeBtns = document.querySelectorAll(".theme button");
const setTheme = (t) => {
  if (t === "light" || t === "dark") root.dataset.theme = t; else delete root.dataset.theme;
  themeBtns.forEach((b) => b.setAttribute("aria-pressed", b.dataset.theme === (root.dataset.theme || "system")));
};
try { setTheme(localStorage.getItem("inplace-theme")); } catch { setTheme(); }
themeBtns.forEach((b) => b.addEventListener("click", () => {
  setTheme(b.dataset.theme);
  try { b.dataset.theme === "system" ? localStorage.removeItem("inplace-theme") : localStorage.setItem("inplace-theme", b.dataset.theme); } catch {}
}));
