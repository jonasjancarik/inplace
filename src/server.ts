// Serve one HTML file for in-place editing, with live reload when it changes on disk.

import { createHash } from "node:crypto";
import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { assignIds, BlockConflict, BlockNotFound, editableIds, patchBlock } from "./htmldoc.js";

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

/** The edited file, plus a version that changes whenever its content does. */
export class Document {
  version = "";
  private stamp = "";
  private listeners = new Set<(version: string) => void>();

  constructor(readonly path: string, readonly writeIds = true) {
    this.refresh();
  }

  private read(): string {
    return readFileSync(this.path, "utf8");
  }

  private write(text: string): void {
    const tmp = join(dirname(this.path), `.${basename(this.path)}.inplace-tmp`);
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, this.path);
    this.version = digest(text);
    this.stamp = this.statStamp();
  }

  private statStamp(): string {
    const s = statSync(this.path);
    return `${s.mtimeMs}:${s.size}`;
  }

  private refresh(): string {
    const text = this.read();
    const version = digest(text);
    this.stamp = this.statStamp();
    if (version !== this.version) {
      this.version = version;
      for (const listener of this.listeners) listener(version);
    }
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
      }
    }
    return { text, version: this.version };
  }

  saveBlock(id: string, oldInner: string, newInner: string): string {
    const text = this.refresh();
    const patched = patchBlock(text, id, oldInner, newInner);
    if (patched !== text) this.write(patched);
    return this.version;
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

export function createInplaceServer(doc: Document): Server {
  const rootDir = dirname(resolve(doc.path));

  const page = (res: ServerResponse) => {
    const { text, version } = doc.load();
    const tag =
      `<script src="${EDITOR_PREFIX}editor.js" data-inplace data-version="${version}" ` +
      `data-file="${escapeAttr(basename(doc.path))}" data-editable="${escapeAttr(editableIds(text).join(" "))}"></script>`;
    const at = text.toLowerCase().lastIndexOf("</body>");
    send(res, 200, at === -1 ? text + tag : text.slice(0, at) + tag + text.slice(at), "text/html; charset=utf-8");
  };

  const events = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    const push = (version: string) => res.write(`event: version\ndata: ${version}\n\n`);
    push(doc.version);
    const off = doc.onChange(push);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      off();
      clearInterval(ping);
    });
  };

  const save = async (req: IncomingMessage, res: ServerResponse) => {
    let body: { id?: unknown; old?: unknown; new?: unknown };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "invalid JSON" });
    }
    const { id, old: oldInner, new: newInner } = body;
    if (typeof id !== "string" || typeof oldInner !== "string" || typeof newInner !== "string") {
      return json(res, 400, { error: "expected id, old and new" });
    }
    try {
      json(res, 200, { version: doc.saveBlock(id, oldInner, newInner) });
    } catch (e) {
      if (e instanceof BlockConflict) return json(res, 409, { error: "conflict", current: e.current, version: doc.version });
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
          return path === EDITOR_PREFIX + "save" ? save(req, res) : json(res, 404, { error: "not found" });
        }
        if (path === "/" || path === "/" + basename(doc.path)) return page(res);
        if (path === EDITOR_PREFIX + "editor.js") {
          return send(res, 200, readFileSync(join(STATIC_DIR, "editor.js")), "text/javascript; charset=utf-8");
        }
        if (path === EDITOR_PREFIX + "events") return events(req, res);
        return staticFile(path, res);
      })
      .catch((e: unknown) => {
        console.error(e);
        if (!res.headersSent) send(res, 500, "internal error", "text/plain");
      });
  });
}
