// Serve one HTML file for in-place editing, with live reload when it changes on disk.

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assignIds, blockHashes, BlockConflict, BlockNotFound, cutChunk, editableIds, elementText, findBlock, insertBlock, movableIds, moveBlock, parse,
  patchBlock, putChunk, removeBlock, replaceElement, retagBlock,
} from "./htmldoc.js";
import { AgentStatus } from "./agent.js";
import { readBuildInfo } from "./build-info.js";
import { buildContext, findQuote } from "./anchor.js";
import { BadOptions, type Comment, CommentNotFound, CommentStore, type CommentTagger, EmptyComment, NotTheirs } from "./comments.js";
import { readEditorScript } from "./editor-script.js";
import { type Author, copyOf, diffBlocks, History, type Place, placeOf } from "./history.js";
import { checkNewLinks, UnsafeLink } from "./links.js";
import { mergeInner } from "./merge.js";
import { type DocumentStore, FileStore } from "./store.js";
import { type ChangeFeed } from "./wait.js";

const EDITOR_PREFIX = "/__inplace/";

/** The files a document can load from its folder; anything else there isn't served. */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json",
  ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml", ".vtt": "text/vtt; charset=utf-8", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  ".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg", ".glb": "model/gltf-binary",
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

/** How many characters `a` and `b` have in common at the start, and then at the end. */
function sharedEnds(a: string, b: string): [number, number] {
  // A large piece at a time first, since comparing strings is much quicker than comparing characters.
  const CHUNK = 4096;
  const most = Math.min(a.length, b.length);
  let head = 0;
  while (head + CHUNK <= most && a.slice(head, head + CHUNK) === b.slice(head, head + CHUNK)) head += CHUNK;
  while (head < most && a[head] === b[head]) head++;
  let tail = 0;
  const end = (s: string, from: number, to: number) => s.slice(s.length - to, s.length - from);
  while (tail + CHUNK <= most - head && end(a, tail, tail + CHUNK) === end(b, tail, tail + CHUNK)) tail += CHUNK;
  while (tail < most - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return [head, tail];
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

export type UndoKind = "move" | "add" | "remove" | "retag";

/** One of the user's changes to the structure, with what it takes to reverse it. */
interface UndoChange {
  kind: UndoKind;
  id: string;
  tag: string;
  before: string; // the file before the change
  after: string; // and right after it
  place?: Place; // move, remove: where the element was
  chunk?: string; // remove: its markup
  from?: string; // retag: the tags before and after
  to?: string;
}

/**
 * A change as it's kept: rather than two copies of a possibly large file, the version of the
 * file right after it, and the one edit that turns that file back into the file from before.
 */
interface UndoStep extends Omit<UndoChange, "before" | "after"> {
  after: string; // the version
  size: number; // and length of the file right after the change
  restore: { at: number; cut: number; text: string }; // replace `cut` characters at `at` with `text`
}

/** An undo that no longer fits the file, with a message for the user. */
export class UndoGone extends Error {}
export class QuoteNotFound extends Error {}

/** The edited document, plus a version that changes whenever its content does. */
export class Document {
  version = "";
  private stamp = "";
  private listeners = new Set<(version: string) => void>();
  private stashListeners = new Set<() => void>();
  private stashed: StashEntry[] = [];
  private historyListeners = new Set<() => void>();
  /** What changed while inplace has been running, for the page's change list. */
  readonly history = new History();
  /** The file as inplace last saw it, with ids, to work out what each change did. */
  private last: string | null = null;
  /** The user's recent moves, additions, removals and heading changes, oldest first, so they can be undone. */
  private undos: UndoStep[] = [];
  /** Comments made on the page, kept beside the stash. */
  readonly comments: CommentStore;
  /** Where the document, the stash and the comments are saved. */
  readonly store: DocumentStore;
  /** The path the document was opened by, or the store's name. */
  readonly path: string;

  /**
   * `where` is a file's path, or a store that keeps the document somewhere else. A path keeps
   * set-aside edits and comments in `stashDir`, so they survive a restart.
   *
   * `log` receives one line per change to the file, for the agent to read. `byUser` is false for
   * changes inplace makes on its own, such as adding ids. `ids` are the elements the user's change
   * left in the document, for the marks beside them that show the agent has seen it.
   */
  constructor(
    where: string | DocumentStore,
    readonly writeIds = true,
    readonly log: (line: string, byUser: boolean, ids?: string[]) => void = () => {},
    stashDir?: string,
  ) {
    this.store = typeof where === "string" ? new FileStore(where, stashDir) : where;
    this.path = typeof where === "string" ? where : where.name;
    const store = this.store;
    this.comments = new CommentStore(
      { load: () => store.loadSide("comments"), save: (json) => store.saveSide("comments", json) },
      (line, byUser) => this.log(line, byUser),
    );
    try {
      this.stashed = JSON.parse(store.loadSide("stash") ?? "[]");
    } catch {
      this.stashed = [];
    }
    this.refresh();
  }

  private read(): string {
    return this.store.read();
  }

  private write(text: string, by?: Author): void {
    this.store.write(text);
    this.stamp = this.statStamp();
    if (by) this.remember(text, by);
    else this.last = text;
    this.announce(digest(text));
  }

  private remember(text: string, by: Author): void {
    if (this.last !== null && this.last !== text && this.history.add(by, diffBlocks(this.last, text)))
      for (const listener of this.historyListeners) listener();
    this.last = text;
  }

  onHistoryChange(listener: () => void): () => void {
    this.historyListeners.add(listener);
    return () => this.historyListeners.delete(listener);
  }

  private announce(version: string): void {
    if (version === this.version) return;
    this.version = version;
    for (const listener of this.listeners) listener(version);
  }

  private statStamp(): string {
    return this.store.stamp();
  }

  /**
   * The file as it is now. It's read every time, which is quick even for a large file, so a
   * change by someone else is never missed; when nothing changed, the text inplace already has
   * is reused, and with it everything worked out from it (its version, and its parse in htmldoc).
   */
  private refresh(): string {
    let text = this.read();
    this.stamp = this.statStamp();
    // A change inplace didn't write came from the agent (or another editor).
    // New elements get their ids as soon as the page loads, so compare with
    // ids already in place to see them as added blocks.
    if (this.last === null) this.last = text;
    else if (text === this.last) text = this.last;
    else this.remember(this.writeIds ? assignIds(text).source : text, "agent");
    this.announce(this.versionOf(text));
    return text;
  }

  private hashed: { text: string; version: string } | null = null;

  /** The version for this text, remembered for the latest one, since hashing a large file takes a while. */
  private versionOf(text: string): string {
    if (this.hashed?.text !== text) this.hashed = { text, version: digest(text) };
    return this.hashed.version;
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
    checkNewLinks(oldInner, newInner);
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
          true, [id],
        );
        throw e;
      }
      this.write(patchBlock(text, id, e.current, merged), "you");
      this.log(`${time()} edited ${id}, merged with the file's newer version: ${describeEdit(e.current, merged)}`, true, [id]);
      return { version: this.version, merged: true };
    }
    if (patched !== text) {
      this.write(patched, "you");
      this.log(`${time()} edited ${id}: ${describeEdit(oldInner, newInner)}`, true, [id]);
    }
    return { version: this.version };
  }

  private stash(id: string, mine: string, theirs: string): number {
    const n = Math.max(0, ...this.stashed.map((e) => e.n)) + 1;
    this.stashed = [...this.stashed, { n, id, mine, theirs: copyOf(theirs), at: new Date().toISOString() }];
    this.saveStash();
    return n;
  }

  private saveStash(): void {
    try {
      this.store.saveSide("stash", JSON.stringify(this.stashed));
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
        if (patched !== text) this.write(patched, "you");
        this.log(`${time()} edited ${entry.id}, using the user's set-aside version: ${describeEdit(current, entry.mine)}`, true, [entry.id]);
      } else {
        const inserted = insertBlock(text, entry.id, "after", node.tag, entry.mine);
        this.write(inserted.source, "you");
        this.log(`${time()} added ${inserted.id} <${node.tag}> after ${entry.id}, with the user's set-aside version: ` +
          JSON.stringify(clip(plain(entry.mine), 200)), true, [inserted.id]);
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
      this.write(moved, "you");
      this.pushUndo({ kind: "move", id, tag: findBlock(parse(text), id)!.tag, before: text, after: moved, place: placeOf(text, id) });
      const parent = findBlock(parse(moved), id)?.parent?.attrs.get("data-id");
      this.log(`${time()} moved ${id} ${position} ${target}${parent ? ` (inside ${parent})` : ""}`, true, [id]);
    }
    return this.version;
  }

  insertBlock(
    id: string, position: "before" | "after", tag: string, content: string, split?: { old: string; new: string },
  ): { id: string; html: string } {
    // The new element's text comes from the block it was split from.
    if (split) checkNewLinks(split.old, split.new + content);
    else checkNewLinks("", content);
    const text = this.refresh();
    const inserted = insertBlock(text, id, position, tag, content, split);
    this.write(inserted.source, "you");
    this.pushUndo({ kind: "add", id: inserted.id, tag, before: text, after: inserted.source });
    if (split && !sameText(split.old, split.new)) this.log(`${time()} edited ${id}: ${describeEdit(split.old, split.new)}`, true, [id]);
    const what = squash(content) ? `: ${JSON.stringify(clip(squash(content), 200))}` : " (empty)";
    this.log(`${time()} added ${inserted.id} <${tag}> ${position} ${id}${what}`, true, [inserted.id]);
    return { id: inserted.id, html: inserted.html };
  }

  removeBlock(id: string): void {
    const text = this.refresh();
    const removed = removeBlock(text, id);
    this.write(removed, "you");
    this.pushUndo({
      kind: "remove", id, tag: findBlock(parse(text), id)!.tag, before: text, after: removed, place: placeOf(text, id),
      chunk: cutChunk(text, id),
    });
    this.log(`${time()} removed ${id}, which the user had emptied`, true);
  }

  retagBlock(id: string, from: string, to: string): string {
    const text = this.refresh();
    const retagged = retagBlock(text, id, from, to);
    if (retagged !== text) {
      this.write(retagged, "you");
      this.pushUndo({ kind: "retag", id, tag: to, before: text, after: retagged, from, to });
      this.log(`${time()} changed ${id} from <${from}> to <${to}>`, true, [id]);
    }
    return this.version;
  }

  // --- undoing the user's moves, additions, removals and heading changes ---

  private pushUndo({ before, after, chunk, ...change }: UndoChange): void {
    const [head, tail] = sharedEnds(before, after);
    this.undos.push({
      ...change,
      ...(chunk === undefined ? {} : { chunk: copyOf(chunk) }),
      after: this.versionOf(after),
      size: after.length,
      restore: { at: head, cut: after.length - head - tail, text: copyOf(before.slice(head, before.length - tail)) },
    });
    if (this.undos.length > 50) this.undos.shift();
  }

  /**
   * The file with `step` reversed. If nothing else has changed since, that is exactly the file
   * from before it; otherwise the element is put back next to one of its old neighbours.
   */
  private reverse(step: UndoStep, text: string): { text: string; where: string } {
    const { id, place } = step;
    const inside = place?.parent ? ` (inside ${place.parent})` : "";
    const anchors = [[place?.next, "before"], [place?.prev, "after"]].filter(([a]) => a) as [string, "before" | "after"][];
    const exact = text.length === step.size && this.versionOf(text) === step.after;
    const { at, cut, text: put } = step.restore;
    const before = () => text.slice(0, at) + put + text.slice(at + cut);
    const gone = (why = "the elements around it have changed") => new UndoGone(`This can't be undone any more, because ${why}.`);
    if (step.kind === "move") {
      for (const [anchor, position] of anchors) {
        try {
          return { text: exact ? before() : moveBlock(text, id, anchor, position), where: `${position} ${anchor}${inside}` };
        } catch {
          // try the other neighbour
        }
      }
      throw gone();
    }
    if (step.kind === "add") {
      if (exact) return { text: before(), where: "" };
      try {
        return { text: removeBlock(text, id), where: "" };
      } catch (e) {
        throw gone(e instanceof BlockConflict ? "it has text in it now" : "it isn't there any more");
      }
    }
    if (step.kind === "remove") {
      if (findBlock(parse(text), id)) throw gone("it's back in the document already");
      for (const [anchor, position] of anchors) {
        try {
          return { text: exact ? before() : putChunk(text, step.chunk!, anchor, position), where: `${position} ${anchor}${inside}` };
        } catch {
          // try the other neighbour
        }
      }
      throw gone();
    }
    try {
      return { text: exact ? before() : retagBlock(text, id, step.to!, step.from!), where: "" };
    } catch {
      throw gone("it has been changed again since");
    }
  }

  /** The user's changes that can still be undone, as the kind of change and the element's id. */
  undoable(): { kind: UndoKind; id: string }[] {
    const text = this.refresh();
    const found = new Map<string, { kind: UndoKind; id: string }>();
    for (const step of [...this.undos].reverse()) {
      const key = `${step.kind} ${step.id}`;
      if (found.has(key)) continue;
      try {
        this.reverse(step, text);
        found.set(key, { kind: step.kind, id: step.id });
      } catch {
        // can't be undone any more
      }
    }
    return [...found.values()];
  }

  /** Undo the user's latest change of this kind to this element. Throws UndoGone if that's no longer possible. */
  undo(kind: UndoKind, id: string): string {
    const i = this.undos.findLastIndex((s) => s.kind === kind && s.id === id);
    if (i === -1) throw new UndoGone("This can't be undone any more.");
    const step = this.undos[i];
    const text = this.refresh();
    const { text: reversed, where } = this.reverse(step, text);
    this.undos.splice(i, 1);
    if (reversed !== text) this.write(reversed, "you");
    const line = {
      move: `moved ${id} ${where}`,
      add: `removed ${id}, which the user had just added`,
      remove: `added ${id} <${step.tag}> back ${where}`,
      retag: `changed ${id} from <${step.to}> to <${step.from}>`,
    }[kind];
    this.log(`${time()} ${line} (undone)`, true, kind === "add" ? [] : [id]);
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

  /** The agent's own comment on the element with this id, or on `quote`, words inside it. */
  addAgentComment(id: string, text: string, quote?: string, options?: string[]): Comment {
    const plain = elementText(this.load().text, id);
    if (plain === null) throw new BlockNotFound(id);
    if (!quote?.trim()) return this.comments.add({ id, text, by: "agent", options });
    const found = findQuote(plain, { quote: quote.trim(), prefix: "", suffix: "" });
    if (!found) throw new QuoteNotFound(`${id} doesn't contain the text ${JSON.stringify(quote.trim())}`);
    return this.comments.add({ id, text, ...buildContext(plain, found.start, found.end), by: "agent", options });
  }

  /**
   * Tag the user's comments with `tagger` as they come in, for the agent to plan its work by. The
   * tagger reads the comment, the words it's on and the element's text, never the whole document.
   */
  useTagger(tagger: CommentTagger): void {
    this.comments.tagger = (c) =>
      tagger({ text: c.text, ...(c.quote ? { quote: c.quote } : {}), element: elementText(this.load().text, c.id) ?? "" });
  }

  /** An agent's edit through tools rather than the file; see replaceElement. */
  replaceElement(id: string, part: "inner" | "outer", expected: string, html: string): void {
    const text = this.load().text;
    const replaced = replaceElement(text, id, part, expected, html);
    if (replaced === text) return;
    this.write(replaced, "agent");
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
    this.write(replaced, "agent");
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

/** The URLs a server listening on `host`:`port` can be opened at, including the extra names it answers to. */
export function serverUrls(port: number, host: string, allowHosts: readonly string[] = []): string[] {
  const urls = [`http://localhost:${port}/`];
  if (host === "0.0.0.0") {
    urls.push(`http://${hostname().replace(/\.local$/, "")}.local:${port}/`);
    for (const name of allowHosts) urls.push(`http://${name}:${port}/`);
  }
  return urls;
}

/** A name given to --allow-host, in the form isLocalHost compares, or null if it isn't a host name. */
export function allowedHostName(value: string): string | null {
  const name = value.trim().toLowerCase().replace(/\.$/, "");
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(name) ? name : null;
}

/**
 * Whether a Host header names this computer: localhost, its own name, an IP address, or one of
 * `allowHosts` (exact names from --allow-host, such as a Tailscale MagicDNS name). Any other name
 * could be a domain an attacker has pointed at 127.0.0.1 (DNS rebinding).
 */
export function isLocalHost(host: string | undefined, allowHosts: readonly string[] = []): boolean {
  if (!host) return false;
  let name: string;
  try {
    name = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (name.endsWith(".")) name = name.slice(0, -1);
  const own = hostname().toLowerCase().replace(/\.local$/, "");
  return name === "localhost" || name.endsWith(".localhost") || name === own || name === `${own}.local` ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || name.startsWith("[") || allowHosts.includes(name);
}

/**
 * Why a request is refused, or null if it may go ahead. Every request needs a Host naming
 * this computer. Changes also need a JSON body, which browsers only send cross-origin after
 * asking first, and, when the browser says where they come from, the page's own origin.
 */
function refusal(req: IncomingMessage, hostAllowed: (host: string | undefined) => boolean): string | null {
  const host = req.headers.host;
  if (!hostAllowed(host)) return "unknown host";
  if (req.method !== "POST") return null;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let same = false;
    try {
      const url = new URL(origin);
      same = (url.protocol === "http:" || url.protocol === "https:") && url.host === new URL(`http://${host}`).host;
    } catch {
      // "null" or garbage: not this page
    }
    if (!same) return "cross-origin request";
  }
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return "expected application/json";
  return null;
}

export interface ServerOptions {
  /** The change lines and pauses, for `/__inplace/wait`. Leave it out when pauses are turned off. */
  feed?: ChangeFeed;
  /** What is known about the agent, for the line in the page's list of changes. */
  agent?: AgentStatus;
  /** More host names the page may be opened by, from --allow-host (see allowedHostName). */
  allowHosts?: readonly string[];
  /**
   * Whether a request's Host header may reach the document, in place of the check for names of
   * this computer (isLocalHost). For a host that serves inplace under its own domain names.
   */
  hostAllowed?: (host: string | undefined) => boolean;
}

export function createInplaceServer(doc: Document, options: ServerOptions = {}): Server {
  return createServer(createInplaceHandler(doc, options));
}

/** The request handler createInplaceServer uses, for a host that runs its own HTTP server. */
export function createInplaceHandler(
  doc: Document, { feed, agent = new AgentStatus(), allowHosts = [], hostAllowed }: ServerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  const hostOk = hostAllowed ?? ((host: string | undefined) => isLocalHost(host, allowHosts));
  // Where the real file is, with the images and stylesheets it loads, even when it was opened through a link.
  const rootDir = doc.store.dir;
  // Read once, so a running server always serves the editor that matches its
  // own endpoints, even after the checkout is updated underneath it.
  const editorScript = readEditorScript();
  const build = readBuildInfo();
  // The page imports the comment anchoring helpers from the same compiled code the server runs.
  const anchorScript = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "anchor.js"), "utf8")
    .replace(/\n\/\/# sourceMappingURL=.*\n?$/, "\n");
  doc.onHistoryChange(() => {
    if (doc.history.entries.at(-1)?.by === "agent") agent.agentWrote();
  });

  const page = (res: ServerResponse) => {
    const { text, version } = doc.load();
    const hashes = blockHashes(text);
    const tag =
      `<script src="${EDITOR_PREFIX}editor.js" data-inplace data-version="${version}" ` +
      `data-file="${escapeAttr(doc.store.name)}" data-build="${escapeAttr(JSON.stringify(build))}" data-editable="${escapeAttr(editableIds(text).join(" "))}" ` +
      `data-movable="${escapeAttr(movableIds(text).join(" "))}"${hashes ? ` data-hashes="${escapeAttr(JSON.stringify(hashes))}"` : ""}></script>`;
    const at = text.toLowerCase().lastIndexOf("</body>");
    send(res, 200, at === -1 ? text + tag : text.slice(0, at) + tag + text.slice(at), "text/html; charset=utf-8");
  };

  const events = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    const push = (version: string) => res.write(`event: version\ndata: ${version}\n\n`);
    const pushStash = () => res.write(`event: stash\ndata: ${doc.stashCount}\n\n`);
    const pushHistory = () => res.write(`event: history\ndata: ${doc.history.revision}\n\n`);
    const pushAgent = () => res.write(`event: agent\ndata: ${JSON.stringify(agent.summary())}\n\n`);
    const pushComments = () => res.write(`event: comments\ndata: ${doc.comments.revision}\n\n`);
    push(doc.version);
    pushStash();
    pushHistory();
    pushAgent();
    pushComments();
    const off = doc.onChange(push);
    const offStash = doc.onStashChange(pushStash);
    const offHistory = doc.onHistoryChange(pushHistory);
    const offAgent = agent.onChange(pushAgent);
    const offComments = doc.comments.onChange(pushComments);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    // Keeps "checked 3 minutes ago" current, and lets "working" run out.
    const refreshAgent = setInterval(pushAgent, 60_000);
    req.on("close", () => {
      off();
      offStash();
      offHistory();
      offAgent();
      offComments();
      clearInterval(ping);
      clearInterval(refreshAgent);
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
    } else if (path === "undo" && id && ["move", "add", "remove", "retag"].includes(body.kind as string)) {
      apply = () => doc.undo(body.kind as UndoKind, id);
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
      const lists = path === "insert" || path === "remove" || path === "undo" || path === "stash/resolve"
        ? (() => { const { text } = doc.load(); return { editable: editableIds(text), movable: movableIds(text) }; })()
        : {};
      json(res, 200, { ...(typeof result === "string" ? {} : result), ...lists, version: doc.version });
    } catch (e) {
      if (e instanceof BlockConflict) {
        return json(res, 409, { error: "conflict", current: e.current, version: doc.version, stash: doc.stashCount });
      }
      if (e instanceof BlockNotFound) return json(res, 404, { error: "block not found", version: doc.version });
      if (e instanceof UnsafeLink) return json(res, 400, { error: e.message, version: doc.version });
      if (e instanceof UndoGone) return json(res, 409, { error: e.message, version: doc.version });
      throw e;
    }
  };

  // Comments: the page adds, edits, deletes and clears the user's, and answers or dismisses the
  // agent's; the agent adds its own and resolves them.
  const comment = async (req: IncomingMessage, res: ServerResponse) => {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "invalid JSON" });
    }
    const str = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : undefined);
    const n = typeof body.n === "number" ? body.n : undefined;
    const comments = doc.comments;
    try {
      if (body.action === "add" && body.by === "agent" && str("id") && str("text") !== undefined) {
        // Only for agents: otherwise anyone who can open the page could write in the agent's name.
        if (req.headers.origin || req.headers["sec-fetch-site"]) return json(res, 403, { error: "not for browsers" });
        const options = Array.isArray(body.options) ? body.options.filter((o): o is string => typeof o === "string") : undefined;
        const added = doc.addAgentComment(str("id")!, str("text")!, str("quote"), options);
        agent.agentWrote();
        return json(res, 200, { comment: added });
      }
      if (body.action === "add" && str("id") && str("text") !== undefined) {
        doc.source(str("id")); // throws if there's no such element
        const added = comments.add({
          id: str("id")!, text: str("text")!, quote: str("quote"), prefix: str("prefix"), suffix: str("suffix"),
        });
        return json(res, 200, { comment: added });
      }
      if (body.action === "edit" && n !== undefined && str("text") !== undefined) {
        return json(res, 200, { comment: comments.edit(n, str("text")!) });
      }
      if (body.action === "delete" && n !== undefined) return (comments.delete(n), json(res, 200, {}));
      if (body.action === "resolve" && n !== undefined) {
        const resolved = comments.resolve(n, str("reply"));
        agent.agentWrote();
        return json(res, 200, { comment: resolved });
      }
      if (body.action === "answer" && n !== undefined && str("text") !== undefined) {
        return json(res, 200, { comment: comments.answer(n, str("text")!) });
      }
      if (body.action === "dismiss" && n !== undefined) return json(res, 200, { comment: comments.dismiss(n) });
      if (body.action === "clear") return json(res, 200, { cleared: comments.clearDone() });
      return json(res, 400, { error: "missing or invalid fields" });
    } catch (e) {
      if (e instanceof CommentNotFound) return json(res, 404, { error: e.message });
      if (e instanceof BlockNotFound) return json(res, 404, { error: `there's no element with data-id "${str("id")}"` });
      if (e instanceof EmptyComment || e instanceof NotTheirs || e instanceof QuoteNotFound || e instanceof BadOptions) return json(res, 400, { error: e.message });
      throw e;
    }
  };

  // `inplace wait`: hold the request open until the user pauses, then answer with the change lines
  // since `after`. A space every 30 seconds shows the connection is alive (JSON allows it before the value).
  const wait = (req: IncomingMessage, res: ServerResponse, query: URLSearchParams) => {
    // Only for agents: a web page could otherwise hold waits open and use up pauses.
    if (req.headers.origin || req.headers["sec-fetch-site"]) return json(res, 403, { error: "not for browsers" });
    if (!feed) return json(res, 409, { error: "pauses are turned off (--pause 0), so there are none to wait for" });
    const after = query.has("after") ? Number(query.get("after")) : feed.delivered;
    const timeout = query.has("timeout") ? Number(query.get("timeout")) * 1000 : undefined;
    if (!Number.isInteger(after) || after < 0 || (timeout !== undefined && !(timeout >= 0))) {
      return json(res, 400, { error: "after must be a whole number and timeout a number of seconds" });
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    const beat = setInterval(() => res.write(" "), 30_000);
    const gone = new AbortController();
    res.on("close", () => gone.abort());
    agent.waitStarted();
    feed.wait(after, timeout, gone.signal).then((batch) => {
      clearInterval(beat);
      agent.waitEnded(batch !== null);
      if (gone.signal.aborted) return;
      res.end(JSON.stringify(batch ? { status: "pause", ...batch } : { status: "timeout", next: after }));
    });
  };

  // Files next to the document, such as its images and stylesheets. Not hidden files or folders
  // (.env, .git), nothing a link leads to outside the folder, and only the kinds of file pages load.
  const hidden = (rel: string) => rel.split(sep).some((part) => part.startsWith("."));
  const staticFile = (path: string, res: ServerResponse) => {
    const notFound = () => send(res, 404, "not found", "text/plain");
    if (rootDir === undefined) return notFound();
    const target = resolve(rootDir, "." + path);
    const rel = relative(rootDir, target);
    const type = MIME[extname(target).toLowerCase()];
    if (!rel || hidden(rel) || !type) return notFound();
    try {
      const realRoot = realpathSync(rootDir);
      const realRel = relative(realRoot, realpathSync(target));
      if (!realRel || isAbsolute(realRel) || hidden(realRel) || !statSync(target).isFile()) return notFound();
      send(res, 200, readFileSync(target), type);
    } catch {
      notFound();
    }
  };

  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = decodeURIComponent(url.pathname);
    Promise.resolve()
      .then(() => {
        const refused = refusal(req, hostOk);
        if (refused) return json(res, 403, { error: refused });
        if (req.method === "POST") {
          const action = path.slice(EDITOR_PREFIX.length);
          if (action === "comment") return comment(req, res);
          return path.startsWith(EDITOR_PREFIX) && ["save", "move", "retag", "insert", "remove", "undo", "stash/resolve"].includes(action)
            ? change(req, res)
            : json(res, 404, { error: "not found" });
        }
        if (path === "/" || path === "/" + doc.store.name) return page(res);
        if (path === EDITOR_PREFIX + "editor.js") {
          return send(res, 200, editorScript, "text/javascript; charset=utf-8");
        }
        if (path === EDITOR_PREFIX + "anchor.js") return send(res, 200, anchorScript, "text/javascript; charset=utf-8");
        if (path === EDITOR_PREFIX + "events") return events(req, res);
        if (path === EDITOR_PREFIX + "comments") {
          // The page asks too; a request that doesn't come from a browser is the agent checking.
          if (!req.headers["sec-fetch-site"]) agent.checked();
          return json(res, 200, { comments: doc.comments.list(url.searchParams.get("open") !== "1"), revision: doc.comments.revision });
        }
        if (path === EDITOR_PREFIX + "wait") return wait(req, res, url.searchParams);
        if (path === EDITOR_PREFIX + "stash") return json(res, 200, { entries: doc.stashEntries() });
        if (path === EDITOR_PREFIX + "history") {
          doc.poll();
          return json(res, 200, { entries: doc.history.entries, revision: doc.history.revision, undoable: doc.undoable() });
        }
        return staticFile(path, res);
      })
      .catch((e: unknown) => {
        console.error(e);
        if (!res.headersSent) send(res, 500, "internal error", "text/plain");
      });
  };
}
