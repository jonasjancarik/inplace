import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { test as base, expect, type Locator, type Page } from "@playwright/test";

const ROOT = resolve(import.meta.dirname, "..");
export const CLI = join(ROOT, "dist", "src", "cli.js");
export const EXAMPLE = join(ROOT, "examples", "garden-proposal.html");
// The servers these tests start keep comments and the rest here, not in the user's own folder.
process.env.INPLACE_STATE_DIR ??= mkdtempSync(join(tmpdir(), "inplace-state-"));

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => ok(port));
    });
  });
}

/** One running inplace server on a private copy of a document. */
export class Doc {
  output = "";
  constructor(readonly path: string, readonly url: string, private proc: ChildProcess) {
    proc.stdout!.on("data", (d) => (this.output += d));
  }

  read(): string {
    return readFileSync(this.path, "utf8");
  }

  /** Change the file the way an agent would: read, replace, write. */
  edit(from: string | RegExp, to: string): void {
    const text = this.read();
    const next = text.replace(from, to);
    if (next === text) throw new Error(`edit: ${from} not found`);
    writeFileSync(this.path, next);
  }

  stop(): void {
    this.proc.kill();
  }
}

export async function startDoc(source = EXAMPLE, html?: string, args: string[] = []): Promise<Doc> {
  const dir = mkdtempSync(join(tmpdir(), "inplace-e2e-"));
  const path = join(dir, "doc.html");
  if (html !== undefined) writeFileSync(path, html);
  else copyFileSync(source, path);
  return serveDoc(path, args);
}

/** Starts a server on a document already on disk, such as one a stopped server was editing. */
export async function serveDoc(path: string, args: string[] = []): Promise<Doc> {
  const port = await freePort();
  const proc = spawn(process.execPath, [CLI, path, "--port", String(port), "--host", "127.0.0.1", ...args], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const doc = new Doc(path, `http://localhost:${port}/`, proc);
  await expect.poll(() => doc.output, { timeout: 5_000 }).toContain(`localhost:${port}`);
  return doc;
}

export const test = base.extend<{ doc: Doc; editor: Page }>({
  doc: async ({}, use) => {
    const doc = await startDoc();
    await use(doc);
    doc.stop();
  },
  // A page with the editor loaded and the server's live-reload stream connected.
  editor: async ({ page, doc }, use) => {
    await page.goto(doc.url);
    await page.waitForFunction(() => document.querySelector("#inplace-toolbar"));
    await use(page);
  },
});

export { expect };

/** The element whose text matches, as the editor sees it. */
export const block = (page: Page, selector: string, text: string | RegExp): Locator =>
  page.locator(selector).filter({ hasText: text }).first();

/**
 * Hover an element so its + and drag buttons appear. Scrolling clears them, so
 * scroll first and then move the mouse, as a person would.
 */
export async function hoverBlock(page: Page, el: Locator): Promise<void> {
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const b = (await el.boundingBox())!;
  await page.mouse.move(b.x + Math.min(40, b.width / 2), b.y + b.height / 2);
  await page.mouse.move(b.x + Math.min(42, b.width / 2), b.y + b.height / 2);
}

/** The data-id of a located element. */
export const idOf = async (el: Locator): Promise<string> => (await el.getAttribute("data-id"))!;

/** Select `text` inside an element, as if the user had dragged across it. */
export async function selectText(el: Locator, text: string): Promise<void> {
  await el.evaluate((node, text) => {
    (node as HTMLElement).focus();
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
      const i = t.data.indexOf(text);
      if (i === -1) continue;
      const range = document.createRange();
      range.setStart(t, i);
      range.setEnd(t, i + text.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error(`selectText: "${text}" not found`);
  }, text);
}

/** Put the caret right after `text` (or at the end of the element). */
export async function caretAfter(el: Locator, text?: string): Promise<void> {
  await el.evaluate((node, text) => {
    (node as HTMLElement).focus();
    const range = document.createRange();
    if (text === undefined) {
      range.selectNodeContents(node);
      range.collapse(false);
    } else {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let t = walker.nextNode() as Text | null;
      for (; t; t = walker.nextNode() as Text | null) if (t.data.includes(text)) break;
      if (!t) throw new Error(`caretAfter: "${text}" not found`);
      range.setStart(t, t.data.indexOf(text) + text.length);
      range.collapse(true);
    }
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  }, text);
}

/** The source of the element with this id, from the file on disk. */
export function sourceOf(doc: Doc, id: string): string {
  const html = doc.read();
  const at = html.indexOf(`data-id="${id}"`);
  if (at === -1) return "";
  const start = html.lastIndexOf("<", at);
  const tag = /^<([a-z0-9]+)/i.exec(html.slice(start))![1];
  const end = html.indexOf(`</${tag}>`, at);
  return html.slice(start, end + tag.length + 3);
}
