// Serve one HTML file for in-place editing, with live reload when it changes on disk.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { hostname, tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assignIds, BlockConflict, BlockNotFound, editableIds, findBlock, insertBlock, movableIds, moveBlock, parse, patchBlock,
  removeBlock, replaceElement, retagBlock,
} from "./htmldoc.js";
import { mergeInner } from "./merge.js";

const EDITOR_PREFIX = "/__inplace/";
const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "static");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm",
};

const digest = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);

const squash = (html: string) => html.replace(/\s+/g, " ").trim();
const clip = (text: string, max: number) =>
  text.length <= max ? text : text.slice(0, max >> 1) + "…" + text.slice(text.length - (max >> 1));

/**
 * `"…was ten trees…" → "…was twelve trees…"`: only the changed part of a block,
 * with a little context, so a one-word edit in a long paragraph stays readable.
 */
export function describeEdit(before: string, after: string, context = 30): string {
  const a = squash(before);
  const b = squash(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  // Widen to whole words so the excerpt doesn't start or end mid-word.
  let from = Math.max(0, head - context);
  while (from > 0 && a[from - 1] !== " ") from--;
  let back = Math.max(0, tail - context);
  while (back > 0 && a[a.length - back] !== " ") back--;
  const excerpt = (s: string) =>
    JSON.stringify((from > 0 ? "…" : "") + clip(s.slice(from, s.length - back), 400) + (back > 0 ? "…" : ""));
  return `${excerpt(a)} → ${excerpt(b)}`;
}

const time = () => new Date().toTimeString().slice(0, 8);
const sameText = (a: string, b: string) => squash(a) === squash(b);
const plain = (html: string) => squash(html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " "));

/** A user's edit that couldn't be saved because the block had changed in the file in the meantime. */
export interface StashEntry {
  n: number;
  id: string;
  mine: string; // the user's inner HTML
  theirs: string; // what the file had when the save was refused
  at: string; // ISO time
}

/** The edited file, plus a version that changes whenever its content does. */
export class Document {
  version = "";
  private stamp = "";
  private listeners = new Set<(version: string) => void>();
  private stashListeners = new Set<() => void>();
  private stashed: StashEntry[] = [];
  /** Where set-aside edits are kept, so they survive a restart. Outside the document's folder on purpose. */
  readonly stashPath: string;

  /**
   * `log` receives one line per change to the file, for the agent to read. `byUser` is false for
   * changes inplace makes on its own, such as adding ids.
   */
  constructor(
    readonly path: string,
    readonly writeIds = true,
    readonly log: (line: string, byUser: boolean) => void = () => {},
    stashDir = join(tmpdir(), "inplace"),
  ) {
    this.stashPath = join(stashDir, `stash-${digest(resolve(path))}.json`);
    try {
      this.stashed = JSON.parse(readFileSync(this.stashPath, "utf8"));
    } catch {
      this.stashed = [];
    }
    this.refresh();
  }

  private read(): string {
    return readFileSync(this.path, "utf8");
  }

  private write(text: string): void {
    const tmp = join(dirname(this.path), `.${basename(this.path)}.inplace-tmp`);
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, this.path);
    this.stamp = this.statStamp();
    this.announce(digest(text));
  }

  private announce(version: string): void {
    if (version === this.version) return;
    this.version = version;
    for (const listener of this.listeners) listener(version);
  }

  private statStamp(): string {
    const s = statSync(this.path);
    return `${s.mtimeMs}:${s.size}`;
  }

  private refresh(): string {
    const text = this.read();
    this.stamp = this.statStamp();
    this.announce(digest(text));
    return text;
  }

  /** Current text with ids on every editable block, and its version. */
  load(): { text: string; version: string } {
    let text = this.refresh();
    if (this.writeIds) {
      const result = assignIds(text);
      if (result.added) {
        text = result.source;
        this.write(text);
        this.log(`${time()} added data-id to ${result.added} element${result.added === 1 ? "" : "s"}`, false);
      }
    }
    return { text, version: this.version };
  }

  /**
   * Save the user's edit to one block. If the block changed in the file since the page loaded it,
   * the two edits are merged when they touch different words; otherwise the user's version is
   * set aside in the stash and BlockConflict is thrown.
   */
  saveBlock(id: string, oldInner: string, newInner: string): { version: string; merged?: true } {
    const text = this.refresh();
    let patched: string;
    try {
      patched = patchBlock(text, id, oldInner, newInner);
    } catch (e) {
      if (!(e instanceof BlockConflict)) throw e;
      const merged = mergeInner(oldInner, newInner, e.current);
      if (merged === null) {
        const n = this.stash(id, newInner, e.current);
        this.log(
          `${time()} conflict on ${id}: the user and the file both changed it, so the user's version was set aside ` +
          `(stash #${n}). The user wrote ${JSON.stringify(clip(plain(newInner), 400))}; ` +
          `the file has ${JSON.stringify(clip(plain(e.current), 400))}`,
          true,
        );
        throw e;
      }
      this.write(patchBlock(text, id, e.current, merged));
      this.log(`${time()} edited ${id}, merged with the file's newer version: ${describeEdit(e.current, merged)}`, true);
      return { version: this.version, merged: true };
    }
    if (patched !== text) {
      this.write(patched);
      this.log(`${time()} edited ${id}: ${describeEdit(oldInner, newInner)}`, true);
    }
    return { version: this.version };
  }

  private stash(id: string, mine: string, theirs: string): number {
    const n = Math.max(0, ...this.stashed.map((e) => e.n)) + 1;
    this.stashed = [...this.stashed, { n, id, mine, theirs, at: new Date().toISOString() }];
    this.saveStash();
    return n;
  }

  private saveStash(): void {
    try {
      mkdirSync(dirname(this.stashPath), { recursive: true });
      writeFileSync(this.stashPath, JSON.stringify(this.stashed), "utf8");
    } catch {
      // the stash still works in memory
    }
    for (const listener of this.stashListeners) listener();
  }

  /** The set-aside edits, each with what its block contains now (null if the block is gone). */
  stashEntries(): (StashEntry & { current: string | null; changed: boolean })[] {
    const { text } = this.load();
    const root = parse(text);
    return this.stashed.map((e) => {
      const node = findBlock(root, e.id);
      const current = node ? text.slice(node.openEnd, node.innerEnd) : null;
      return { ...e, current, changed: current !== null && plain(current) !== plain(e.theirs) };
    });
  }

  get stashCount(): number {
    return this.stashed.length;
  }

  /**
   * Act on a set-aside edit: put the user's version in place of the block's current content
   * ("mine"), add it as a new block right after ("below"), or drop it ("discard").
   */
  resolveStash(n: number, action: "mine" | "below" | "discard"): void {
    const entry = this.stashed.find((e) => e.n === n);
    if (!entry) throw new BlockNotFound(`stash #${n}`);
    if (action !== "discard") {
      const text = this.load().text;
      const node = findBlock(parse(text), entry.id);
      if (!node) throw new BlockNotFound(entry.id);
      const current = text.slice(node.openEnd, node.innerEnd);
      if (action === "mine") {
        const patched = patchBlock(text, entry.id, current, entry.mine);
        if (patched !== text) this.write(patched);
        this.log(`${time()} edited ${entry.id}, using the user's set-aside version: ${describeEdit(current, entry.mine)}`, true);
      } else {
        const inserted = insertBlock(text, entry.id, "after", node.tag, entry.mine);
        this.write(inserted.source);
        this.log(`${time()} added ${inserted.id} <${node.tag}> after ${entry.id}, with the user's set-aside version: ` +
          JSON.stringify(clip(plain(entry.mine), 200)), true);
      }
    }
    this.stashed = this.stashed.filter((e) => e.n !== n);
    this.saveStash();
  }

  onStashChange(listener: () => void): () => void {
    this.stashListeners.add(listener);
    return () => this.stashListeners.delete(listener);
  }

  moveBlock(id: string, target: string, position: "before" | "after"): string {
    const text = this.refresh();
    const moved = moveBlock(text, id, target, position);
    if (moved !== text) {
      this.write(moved);
      const parent = findBlock(parse(moved), id)?.parent?.attrs.get("data-id");
      this.log(`${time()} moved ${id} ${position} ${target}${parent ? ` (inside ${parent})` : ""}`, true);
    }
    return this.version;
  }

  insertBlock(
    id: string, position: "before" | "after", tag: string, content: string, split?: { old: string; new: string },
  ): { id: string; html: string } {
    const text = this.refresh();
    const inserted = insertBlock(text, id, position, tag, content, split);
    this.write(inserted.source);
    if (split && !sameText(split.old, split.new)) this.log(`${time()} edited ${id}: ${describeEdit(split.old, split.new)}`, true);
    const what = squash(content) ? `: ${JSON.stringify(clip(squash(content), 200))}` : " (empty)";
    this.log(`${time()} added ${inserted.id} <${tag}> ${position} ${id}${what}`, true);
    return { id: inserted.id, html: inserted.html };
  }

  removeBlock(id: string): void {
    const text = this.refresh();
    this.write(removeBlock(text, id));
    this.log(`${time()} removed ${id}, which the user had emptied`, true);
  }

  retagBlock(id: string, from: string, to: string): string {
    const text = this.refresh();
    const retagged = retagBlock(text, id, from, to);
    if (retagged !== text) {
      this.write(retagged);
      this.log(`${time()} changed ${id} from <${from}> to <${to}>`, true);
    }
    return this.version;
  }

  /** The whole file, or the element with this id, as it is now (with ids added). */
  source(id?: string): string {
    const { text } = this.load();
    if (id === undefined) return text;
    const node = findBlock(parse(text), id);
    if (!node) throw new BlockNotFound(id);
    return text.slice(node.start, node.end);
  }

  /** An agent's edit through tools rather than the file; see replaceElement. */
  replaceElement(id: string, part: "inner" | "outer", expected: string, html: string): void {
    const text = this.load().text;
    const replaced = replaceElement(text, id, part, expected, html);
    if (replaced === text) return;
    this.write(replaced);
    this.log(`${time()} the agent replaced ${part === "inner" ? "the inside of " : ""}${id}`, false);
  }

  /** Replace `find` with `replace` in the file's source; returns how many were replaced. */
  findReplace(find: string, replace: string, all: boolean): number {
    if (!find) throw new Error("find is empty");
    const text = this.load().text;
    const count = text.split(find).length - 1;
    if (!count) throw new Error("not found in the file");
    if (count > 1 && !all) throw new Error(`found ${count} times; make find longer so it's unique, or pass all: true`);
    const replaced = all ? text.split(find).join(replace) : text.replace(find, () => replace);
    if (replaced === text) return 0;
    this.write(replaced);
    this.log(`${time()} the agent replaced ${count} occurrence${count === 1 ? "" : "s"} of ${JSON.stringify(clip(find, 60))}`, false);
    return count;
  }

  /** Re-read the file if its size or mtime changed. Cheap enough to call every few hundred ms. */
  poll(): void {
    try {
      if (this.statStamp() !== this.stamp) this.refresh();
    } catch {
      // mid-rename by an editor; pick it up on the next poll
    }
  }

  onChange(listener: (version: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string): void {
  res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(body);
}

const json = (res: ServerResponse, status: number, payload: unknown) =>
  send(res, status, JSON.stringify(payload), "application/json");

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The URLs a server listening on `host`:`port` can be opened at. */
export function serverUrls(port: number, host: string): string[] {
  const urls = [`http://localhost:${port}/`];
  if (host === "0.0.0.0") urls.push(`http://${hostname().replace(/\.local$/, "")}.local:${port}/`);
  return urls;
}

export function createInplaceServer(doc: Document): Server {
  const rootDir = dirname(resolve(doc.path));
  // Read once, so a running server always serves the editor that matches its
  // own endpoints, even after the checkout is updated underneath it.
  const editorScript = readFileSync(join(STATIC_DIR, "editor.js"));

  const page = (res: ServerResponse) => {
    const { text, version } = doc.load();
    const tag =
      `<script src="${EDITOR_PREFIX}editor.js" data-inplace data-version="${version}" ` +
      `data-file="${escapeAttr(basename(doc.path))}" data-editable="${escapeAttr(editableIds(text).join(" "))}" ` +
      `data-movable="${escapeAttr(movableIds(text).join(" "))}"></script>`;
    const at = text.toLowerCase().lastIndexOf("</body>");
    send(res, 200, at === -1 ? text + tag : text.slice(0, at) + tag + text.slice(at), "text/html; charset=utf-8");
  };

  const events = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    const push = (version: string) => res.write(`event: version\ndata: ${version}\n\n`);
    const pushStash = () => res.write(`event: stash\ndata: ${doc.stashCount}\n\n`);
    push(doc.version);
    pushStash();
    const off = doc.onChange(push);
    const offStash = doc.onStashChange(pushStash);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      off();
      offStash();
      clearInterval(ping);
    });
  };

  // Each change from the page is one small JSON request; the handler returns
  // the new version, or undefined (after replying 400) if the body is malformed.
  const change = async (req: IncomingMessage, res: ServerResponse) => {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "invalid JSON" });
    }
    const str = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : null);
    const path = new URL(req.url ?? "/", "http://localhost").pathname.slice(EDITOR_PREFIX.length);
    let apply: (() => string | Record<string, unknown>) | null = null;
    const id = str("id");
    if (path === "save" && id && str("old") !== null && str("new") !== null) {
      apply = () => doc.saveBlock(id, str("old")!, str("new")!);
    } else if (path === "move" && id && str("target") && (body.position === "before" || body.position === "after")) {
      apply = () => doc.moveBlock(id, str("target")!, body.position as "before" | "after");
    } else if (path === "retag" && id && str("from") && str("to")) {
      apply = () => doc.retagBlock(id, str("from")!, str("to")!);
    } else if (path === "insert" && id && str("tag") && str("content") !== null &&
        (body.position === "before" || body.position === "after")) {
      const split = str("old") !== null && str("new") !== null ? { old: str("old")!, new: str("new")! } : undefined;
      apply = () => doc.insertBlock(id, body.position as "before" | "after", str("tag")!, str("content")!, split);
    } else if (path === "remove" && id) {
      apply = () => (doc.removeBlock(id), {});
    } else if (path === "stash/resolve" && typeof body.n === "number" &&
        (body.action === "mine" || body.action === "below" || body.action === "discard")) {
      apply = () => (doc.resolveStash(body.n as number, body.action as "mine" | "below" | "discard"), {});
    }
    if (!apply) return json(res, 400, { error: "missing or invalid fields" });
    try {
      const result = apply();
      // Structure changed: send the page the new lists of editable and movable elements.
      const lists = path === "insert" || path === "remove" || path === "stash/resolve"
        ? (() => { const { text } = doc.load(); return { editable: editableIds(text), movable: movableIds(text) }; })()
        : {};
      json(res, 200, { ...(typeof result === "string" ? {} : result), ...lists, version: doc.version });
    } catch (e) {
      if (e instanceof BlockConflict) {
        return json(res, 409, { error: "conflict", current: e.current, version: doc.version, stash: doc.stashCount });
      }
      if (e instanceof BlockNotFound) return json(res, 404, { error: "block not found", version: doc.version });
      throw e;
    }
  };

  const staticFile = (path: string, res: ServerResponse) => {
    const target = resolve(rootDir, "." + path);
    const rel = relative(rootDir, target);
    if (rel.startsWith("..") || rel.split(sep).includes("..")) return send(res, 404, "not found", "text/plain");
    try {
      if (!statSync(target).isFile()) throw new Error();
      send(res, 200, readFileSync(target), MIME[extname(target).toLowerCase()] ?? "application/octet-stream");
    } catch {
      send(res, 404, "not found", "text/plain");
    }
  };

  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = decodeURIComponent(url.pathname);
    Promise.resolve()
      .then(() => {
        if (req.method === "POST") {
          const action = path.slice(EDITOR_PREFIX.length);
          return path.startsWith(EDITOR_PREFIX) && ["save", "move", "retag", "insert", "remove", "stash/resolve"].includes(action)
            ? change(req, res)
            : json(res, 404, { error: "not found" });
        }
        if (path === "/" || path === "/" + basename(doc.path)) return page(res);
        if (path === EDITOR_PREFIX + "editor.js") {
          return send(res, 200, editorScript, "text/javascript; charset=utf-8");
        }
        if (path === EDITOR_PREFIX + "events") return events(req, res);
        if (path === EDITOR_PREFIX + "stash") return json(res, 200, { entries: doc.stashEntries() });
        return staticFile(path, res);
      })
      .catch((e: unknown) => {
        console.error(e);
        if (!res.headersSent) send(res, 500, "internal error", "text/plain");
      });
  });
}
