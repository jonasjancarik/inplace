// Where a document and what inplace keeps beside it (set-aside edits, comments, who wrote what,
// the agent's changes still to review) are saved.
// The CLI keeps them in files; a host that embeds inplace can keep them anywhere else,
// such as a database, by passing its own DocumentStore to Document.

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync,
  utimesSync, writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { documentIdOf } from "./htmldoc.js";

/** What inplace keeps beside a document. */
export type SideData = "stash" | "comments" | "authors" | "pending";
const SIDE_DATA: SideData[] = ["stash", "comments", "authors", "pending"];

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
  /**
   * The id to write into the document as `<meta name="inplace-id">` along with the data-ids, for
   * a store that finds the document's side data by it. Left out, nothing is written.
   */
  documentId?(): string;
}

const digest = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);

/** Side data nobody has opened for this long is deleted. */
const FORGET_AFTER_DAYS = 90;

/**
 * Where FileStore keeps side data unless told otherwise: `$INPLACE_STATE_DIR`, or the system's
 * place for an app's own data, outside any project and not emptied like the temporary folder.
 */
export function defaultSideDir(): string {
  if (process.env.INPLACE_STATE_DIR) return process.env.INPLACE_STATE_DIR;
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "inplace");
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "inplace");
  return join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "inplace");
}

/** Where side data was kept before it moved to defaultSideDir. */
const OLD_SIDE_DIR = join(tmpdir(), "inplace");

let tidied = false;

/** Delete side data that hasn't been opened or saved for FORGET_AFTER_DAYS. Once per process. */
function tidy(dir: string): void {
  if (tidied) return;
  tidied = true;
  const before = Date.now() - FORGET_AFTER_DAYS * 24 * 60 * 60 * 1000;
  try {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).mtimeMs < before) rmSync(path, { force: true });
    }
  } catch {
    // nothing kept yet, or it can't be read; either way there's nothing to tidy
  }
}

/**
 * A file on disk, with the stash and comments in `sideDir`, outside the document's folder on purpose.
 *
 * Side data is found by the id in the document's `<meta name="inplace-id">`, which Document writes
 * along with the data-ids, so it follows the document when it's moved or renamed. A document without
 * one (such as with `--no-write-ids`) is found by its path. A copy of a document has the same id as
 * the original; it gets a copy of the original's side data and an id of its own.
 */
export class FileStore implements DocumentStore {
  /** The file `path` leads to, after following links: inplace reads and writes this one. */
  readonly file: string;
  readonly name: string;
  readonly dir: string;
  readonly sideDir: string;
  /** The side data's file names start with this: the document's id, or a digest of its path. */
  private sidePrefix: string;
  /** The id the document has, or gets the next time inplace writes it. */
  private id: string;

  constructor(readonly path: string, sideDir?: string) {
    this.file = realpathSync(path);
    this.name = basename(path);
    this.dir = dirname(this.file);
    this.sideDir = sideDir ?? defaultSideDir();
    this.sidePrefix = digest(this.file);
    this.id = randomBytes(6).toString("hex");
    if (sideDir === undefined) tidy(this.sideDir);
    // Side data kept under an older name: by the path as typed, and in the temporary folder.
    const older = [...new Set([digest(resolve(path)), this.sidePrefix])];
    const places = [this.sideDir, ...(sideDir === undefined ? [OLD_SIDE_DIR] : [])]
      .flatMap((dir) => older.map((prefix) => ({ dir, prefix })));
    const found = places.find((p) => this.hasSide(p.dir, p.prefix));
    if (found) this.carry(found, { dir: this.sideDir, prefix: this.sidePrefix }, false);
    this.read(); // finds the side data by the document's id
    this.touch();
  }

  documentId(): string {
    return this.id;
  }

  private sideFile(dir: string, prefix: string, key: SideData | "where"): string {
    return join(dir, `${key}-${prefix}.${key === "where" ? "txt" : "json"}`);
  }

  private hasSide(dir: string, prefix: string): boolean {
    return SIDE_DATA.some((key) => existsSync(this.sideFile(dir, prefix, key)));
  }

  /** Move (or copy) side data to another name, unless the other name has some already. */
  private carry(from: { dir: string; prefix: string }, to: { dir: string; prefix: string }, copy: boolean): void {
    if (from.dir === to.dir && from.prefix === to.prefix) return;
    if (this.hasSide(to.dir, to.prefix)) return;
    try {
      mkdirSync(to.dir, { recursive: true, mode: 0o700 });
      for (const key of SIDE_DATA) {
        const source = this.sideFile(from.dir, from.prefix, key);
        if (!existsSync(source)) continue;
        const target = this.sideFile(to.dir, to.prefix, key);
        if (copy) copyFileSync(source, target);
        else {
          try {
            renameSync(source, target);
          } catch {
            // another disk, as the temporary folder can be
            copyFileSync(source, target);
            rmSync(source, { force: true });
          }
        }
      }
    } catch {
      // left where it was; inplace starts without it
    }
  }

  /**
   * Find side data by the id in `text`, moving it there from the path's name the first time.
   * When the id belongs to another file that still has it, this one is a copy: it keeps its own
   * name, starts with a copy of the other's side data, and gets a new id.
   */
  private follow(text: string): void {
    const id = documentIdOf(text);
    if (!id || id === this.sidePrefix) return;
    const where = this.sideFile(this.sideDir, id, "where");
    let other: string | undefined;
    try {
      other = readFileSync(where, "utf8");
    } catch {
      // no file has had this id yet
    }
    let copied = false;
    if (other && other !== this.file) {
      try {
        copied = documentIdOf(readFileSync(other, "utf8")) === id;
      } catch {
        // the other file is gone: this one is it, moved
      }
    }
    if (copied) {
      this.carry({ dir: this.sideDir, prefix: id }, { dir: this.sideDir, prefix: this.sidePrefix }, true);
      return;
    }
    this.carry({ dir: this.sideDir, prefix: this.sidePrefix }, { dir: this.sideDir, prefix: id }, false);
    this.sidePrefix = this.id = id;
    try {
      mkdirSync(this.sideDir, { recursive: true, mode: 0o700 });
      writeFileSync(where, this.file, "utf8");
    } catch {
      // a copy then can't be told from the original, and shares its side data
    }
  }

  /** Mark this document's side data as used, so tidying leaves it alone. */
  private touch(): void {
    const now = new Date();
    for (const key of [...SIDE_DATA, "where"] as const) {
      try {
        utimesSync(this.sideFile(this.sideDir, this.sidePrefix, key), now, now);
      } catch {
        // not saved yet
      }
    }
  }

  read(): string {
    const text = readFileSync(this.file, "utf8");
    this.follow(text);
    return text;
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
    this.follow(text);
  }

  stamp(): string {
    const s = statSync(this.file);
    return `${s.mtimeMs}:${s.size}`;
  }

  /** Where `key` is kept, e.g. `~/Library/Application Support/inplace/comments-1a2b3c4d5e6f.json`. */
  sidePath(key: SideData): string {
    return this.sideFile(this.sideDir, this.sidePrefix, key);
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
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
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
