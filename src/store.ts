// Where a document and what inplace keeps beside it (set-aside edits, comments, who wrote what,
// the agent's changes still to review) are saved.
// The CLI keeps them in files; a host that embeds inplace can keep them anywhere else,
// such as a database, by passing its own DocumentStore to Document.

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/** What inplace keeps beside a document. */
export type SideData = "stash" | "comments" | "authors" | "pending";

export interface DocumentStore {
  /** The document's name, such as its file name, for the page and the change lines. */
  readonly name: string;
  /** The folder the document's images and stylesheets are served from, if it has one. */
  readonly dir?: string;
  read(): string;
  write(text: string): void;
  /**
   * A value that changes whenever the document may have changed, cheap enough to check every
   * few hundred milliseconds. A store that only Document writes to can return a constant.
   */
  stamp(): string;
  /** The JSON last saved under `key`, or null if there's none. */
  loadSide(key: SideData): string | null;
  /** Save `json` under `key`. A store that can't should throw; inplace then keeps it in memory. */
  saveSide(key: SideData, json: string): void;
}

const digest = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);

/** A file on disk, with the stash and comments in `sideDir`, outside the document's folder on purpose. */
export class FileStore implements DocumentStore {
  /** The file `path` leads to, after following links: inplace reads and writes this one. */
  readonly file: string;
  readonly name: string;
  readonly dir: string;
  private readonly sidePrefix: string;

  constructor(readonly path: string, readonly sideDir = join(tmpdir(), "inplace")) {
    this.file = realpathSync(path);
    this.name = basename(path);
    this.dir = dirname(this.file);
    this.sidePrefix = digest(resolve(path));
  }

  read(): string {
    return readFileSync(this.file, "utf8");
  }

  /**
   * Write through a temporary file, so nothing ever reads a half-written document. The temporary
   * file gets the document's permissions, and goes next to the real file rather than a link to it,
   * so links stay links. A file with other hard links is written in place, or they'd keep the old text.
   */
  write(text: string): void {
    const { mode, nlink } = statSync(this.file);
    if (nlink > 1) {
      writeFileSync(this.file, text, "utf8");
    } else {
      const tmp = join(dirname(this.file), `.${basename(this.file)}.inplace-tmp`);
      writeFileSync(tmp, text, "utf8");
      chmodSync(tmp, mode & 0o7777);
      renameSync(tmp, this.file);
    }
  }

  stamp(): string {
    const s = statSync(this.file);
    return `${s.mtimeMs}:${s.size}`;
  }

  /** Where `key` is kept, e.g. `/tmp/inplace/comments-1a2b3c4d5e6f.json`. */
  sidePath(key: SideData): string {
    return join(this.sideDir, `${key}-${this.sidePrefix}.json`);
  }

  loadSide(key: SideData): string | null {
    try {
      return readFileSync(this.sidePath(key), "utf8");
    } catch {
      return null;
    }
  }

  saveSide(key: SideData, json: string): void {
    const path = this.sidePath(key);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, json, "utf8");
    renameSync(tmp, path);
  }
}

/** A document held in memory, for tests and for hosts that save it themselves through `onWrite`. */
export class MemoryStore implements DocumentStore {
  private writes = 0;
  private side = new Map<SideData, string>();

  constructor(
    readonly name: string,
    private text: string,
    side: Partial<Record<SideData, string>> = {},
    readonly onWrite: (text: string) => void = () => {},
    readonly onSaveSide: (key: SideData, json: string) => void = () => {},
  ) {
    for (const [key, json] of Object.entries(side)) if (json !== undefined) this.side.set(key as SideData, json);
  }

  read(): string {
    return this.text;
  }

  write(text: string): void {
    this.text = text;
    this.writes++;
    this.onWrite(text);
  }

  stamp(): string {
    return String(this.writes);
  }

  loadSide(key: SideData): string | null {
    return this.side.get(key) ?? null;
  }

  saveSide(key: SideData, json: string): void {
    this.side.set(key, json);
    this.onSaveSide(key, json);
  }
}
