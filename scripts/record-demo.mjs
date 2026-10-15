// Records docs/demo.gif: a short, real session with inplace on the example
// document. Needs ffmpeg. Run with `npm run record-demo`.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "demo.gif");
const work = mkdtempSync(join(tmpdir(), "inplace-demo-"));
const file = join(work, "garden-proposal.html");
copyFileSync(join(ROOT, "examples", "garden-proposal.html"), file);

const PORT = 8799;
const server = spawn(process.execPath, [join(ROOT, "dist/src/cli.js"), file, "--port", String(PORT), "--host", "127.0.0.1"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

// A visible pointer and a caption bar; recordings don't show the real cursor.
const overlay = () => {
  addEventListener("DOMContentLoaded", () => {
    const cursor = document.createElement("div");
    cursor.innerHTML = `<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8-6 1.6L8 18z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    Object.assign(cursor.style, { position: "fixed", left: "0", top: "0", zIndex: 2147483647, pointerEvents: "none", transform: "translate(var(--x, -40px), var(--y, -40px))" });
    const caption = document.createElement("div");
    caption.id = "demo-caption";
    Object.assign(caption.style, {
      position: "fixed", left: "50%", bottom: "18px", transform: "translateX(-50%)", zIndex: 2147483647, pointerEvents: "none",
      background: "#1f2a24", color: "#fff", font: "500 15px/1.3 -apple-system, system-ui, sans-serif", padding: "9px 14px",
      borderRadius: "9px", boxShadow: "0 4px 16px #0003", transition: "opacity .2s", opacity: "0", whiteSpace: "nowrap",
    });
    document.body.append(cursor, caption);
    const saved = JSON.parse(sessionStorage.getItem("demo-pointer") || "null");
    if (saved) cursor.style.cssText += `;--x:${saved.x}px;--y:${saved.y}px`;
    addEventListener("mousemove", (e) => {
      cursor.style.setProperty("--x", `${e.clientX - 3}px`);
      cursor.style.setProperty("--y", `${e.clientY - 2}px`);
      sessionStorage.setItem("demo-pointer", JSON.stringify({ x: e.clientX - 3, y: e.clientY - 2 }));
    }, true);
  });
};

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 960, height: 600 },
  recordVideo: { dir: work, size: { width: 960, height: 600 } },
});
await context.addInitScript(overlay);
const page = await context.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const caption = (text) => page.evaluate((t) => {
  const c = document.getElementById("demo-caption");
  if (!c) return;
  c.textContent = t;
  c.style.opacity = t ? "1" : "0";
}, text);
async function moveTo(locator, dx = 0.5, dy = 0.5) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width * dx, b.y + b.height * dy, { steps: 18 });
}

await page.goto(`http://localhost:${PORT}/`);
await wait(1200);

// 1. Bold a word with the toolbar
await caption("Select text to format it");
const lead = page.locator("p.lead");
const word = await lead.evaluate((el) => {
  const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.data.includes("shared"));
  const r = document.createRange();
  const i = t.data.indexOf("shared");
  r.setStart(t, i);
  r.setEnd(t, i + 6);
  const b = r.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
});
await page.mouse.move(word.x + 2, word.y + word.h / 2, { steps: 20 });
await wait(250);
await page.mouse.down();
await page.mouse.move(word.x + word.w - 1, word.y + word.h / 2, { steps: 10 });
await page.mouse.up();
await wait(700);
await moveTo(page.locator("#inplace-toolbar").getByTitle(/^Bold/));
await wait(300);
await page.locator("#inplace-toolbar").getByTitle(/^Bold/).click();
await wait(1100);

// 2. Type a sentence
await caption("Click anywhere and type");
const para = page.locator("p").filter({ hasText: "The roof is already used" });
const end = await para.evaluate((el) => {
  const r = document.createRange();
  r.selectNodeContents(el);
  const rects = r.getClientRects();
  const last = rects[rects.length - 1];
  return { x: last.right - 2, y: last.y + last.height / 2 };
});
await page.mouse.move(end.x, end.y, { steps: 20 });
await page.mouse.click(end.x, end.y);
await wait(300);
await page.keyboard.press("End");
await page.keyboard.type(" Bikes can stay where they are.", { delay: 55 });
await wait(1300);

// 3. Add a row with +
await caption("Add a row with +");
await page.evaluate(() => scrollTo({ top: 260, behavior: "smooth" }));
await wait(900);
const row = page.locator("tr").filter({ hasText: "Soil and compost" });
await moveTo(row, 0.3);
await wait(400);
const plus = page.getByRole("button", { name: "Add a row below" });
await moveTo(plus);
await wait(300);
await plus.click();
await wait(500);
await page.keyboard.type("Seeds and plants", { delay: 55 });
const cells = page.locator(`tr:has(> td:text-is("Seeds and plants")) > td`);
await moveTo(cells.nth(1), 0.2);
await cells.nth(1).click();
await page.keyboard.type("Herbs and vegetables for the first season", { delay: 40 });
await moveTo(cells.nth(2), 0.6);
await cells.nth(2).click();
await page.keyboard.type("€300", { delay: 90 });
await page.mouse.move(500, 560, { steps: 15 });
await page.mouse.click(500, 560);
await wait(1200);

// 4. The agent reads the change log and fixes the total
await caption("Your agent sees the new row and updates the total");
await wait(1400);
writeFileSync(file, readFileSync(file, "utf8").replace("€7,900", "€8,200"));
await wait(1600);
await caption("Your agent sees the new row and updates the total");
await page.locator("tr.total").evaluate((el) => {
  el.style.transition = "background .4s";
  el.style.background = "#fbefc8";
});
await wait(2600);

await context.close();
await browser.close();
server.kill();

const video = join(work, readdirSync(work).find((f) => f.endsWith(".webm")));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video,
  "-vf", "fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
  OUT]);
console.log(`Wrote ${OUT}`);
