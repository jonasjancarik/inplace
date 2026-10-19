// Comments on the page, kept outside the document until they've been dealt with. Most are
// the user's requests to the agent; the agent can also leave its own, for the user to answer
// or dismiss. Each change is also a change line, so the agent hears about comments every
// way it hears about edits.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { type Author, readAuthor } from "./history.js";

/** Where the comments are saved: a JSON file, or a host's own storage. */
export interface CommentPersistence {
  load(): string | null;
  save(json: string): void;
}

/** A JSON file, written through a temporary file. */
export function commentsFile(path: string): CommentPersistence {
  return {
    load: () => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    save: (json) => {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, json, "utf8");
      renameSync(tmp, path);
    },
  };
}

export interface Comment {
  n: number; // unique for the life of the comments file
  id: string; // data-id of the element the comment is on
  quote?: string; // the selected text, if the comment is on part of the element's text
  prefix?: string;
  suffix?: string;
  text: string;
  by?: Author; // left by the agent (kind "agent"); without it, by a person
  from?: Author; // the person who left it, when the host knows who that is
  options?: string[]; // answers the agent suggests for its comment, for the user to pick with one click
  answer?: string; // the user's answer to the agent's comment
  dismissed?: boolean; // the user closed the agent's comment without asking for anything
  status: "open" | "done";
  created: string; // ISO time
  resolved?: string;
  reply?: string; // the agent's note to the user when it resolved the comment
  tag?: CommentTag; // what kind of request the user's comment is, when a tagger is set and was sure
}

/** The kinds of request a user's comment can be tagged with, for the agent to plan its work by. */
export const COMMENT_TAGS = ["small fix", "rewrite", "content", "question", "layout"] as const;
export type CommentTag = (typeof COMMENT_TAGS)[number];

/** What a tagger reads: the comment, the words it's on, and the text of the element it's on. */
export interface TagRequest {
  text: string;
  quote?: string;
  element: string;
}

/** Tags a user's comment, or resolves to undefined when it's unsure or couldn't ask. */
export type CommentTagger = (request: TagRequest) => Promise<CommentTag | undefined>;

export class CommentNotFound extends Error {}
export class NotTheirs extends Error {}
export class BadOptions extends Error {}
export class EmptyComment extends Error {
  constructor() {
    super("the comment is empty");
  }
}

const TEXT_MAX = 500;
const OPTIONS_MAX = 3;
const OPTION_MAX = 100;
const time = () => new Date().toTimeString().slice(0, 8);
const clip = (text: string, max: number) => (text.length <= max ? text : text.slice(0, max - 1) + "…");
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
/** Quoted and on one line, like the excerpts in edit lines, so comment text can't add lines of its own. */
const quoted = (text: string, max: number) => JSON.stringify(clip(oneLine(text), max));

export class CommentStore {
  private comments: Comment[] = [];
  private last = 0;
  private listeners = new Set<() => void>();
  /** Goes up with every change, for the page's `comments` event. */
  revision = 0;
  /** Tags the user's comments in the background; see Document.useTagger. */
  tagger?: (comment: Comment) => Promise<CommentTag | undefined>;

  private readonly persist: CommentPersistence;

  /**
   * `where` is a JSON file's path, or a host's own storage. `log` gets one change line per change;
   * `byUser` is false for the agent resolving a comment.
   */
  constructor(where: string | CommentPersistence, readonly log: (line: string, byUser: boolean) => void = () => {}) {
    this.persist = typeof where === "string" ? commentsFile(where) : where;
    try {
      const saved = JSON.parse(this.persist.load() ?? "");
      this.comments = saved.comments ?? [];
      // Comments saved before authors were objects have by: "agent".
      for (const c of this.comments) if (c.by) c.by = readAuthor(c.by) ?? undefined;
      this.last = saved.last ?? Math.max(0, ...this.comments.map((c) => c.n));
    } catch {
      // no comments yet
    }
  }

  /** Open comments, or all of them, oldest first. */
  list(includeDone = true): Comment[] {
    return this.comments.filter((c) => includeDone || c.status === "open");
  }

  /**
   * A line saying which comments are still open from an earlier run, so an agent that has just
   * started (perhaps a different one) handles them; undefined when there are none. `command`
   * is how this agent reads them in full, such as `inplace comments`.
   */
  stillOpen(command: string): string | undefined {
    const open = this.list(false);
    // The user's comments, and the agent's that the user has answered, wait for the agent.
    const todo = open.filter((c) => !c.by || c.answer !== undefined);
    const asked = open.filter((c) => c.by && c.answer === undefined);
    const lines: string[] = [];
    if (todo.length) {
      const which = todo.map((c) => `#${c.n} on ${c.id}${c.by ? " (your comment, answered by the user)" : ""}`).join(", ");
      lines.push(`${todo.length === 1 ? "1 comment from before is" : `${todo.length} comments from before are`} still open: ` +
        `${which}. Read ${todo.length === 1 ? "it" : "them"} in full with ${command} and deal with ${todo.length === 1 ? "it" : "them"} as usual.`);
    }
    if (asked.length) {
      lines.push(`${asked.length === 1 ? "1 comment of yours is" : `${asked.length} comments of yours are`} still waiting for the user: ` +
        `${asked.map((c) => `#${c.n} on ${c.id}`).join(", ")}.`);
    }
    return lines.length ? lines.join("\n") : undefined;
  }

  get(n: number): Comment {
    const comment = this.comments.find((c) => c.n === n);
    if (!comment) throw new CommentNotFound(`no comment #${n}`);
    return comment;
  }

  add(fields: { id: string; text: string; quote?: string; prefix?: string; suffix?: string; by?: Author; from?: Author; options?: string[] }): Comment {
    const text = fields.text.trim();
    if (!text) throw new EmptyComment();
    const quote = fields.quote?.trim() ? fields.quote : undefined;
    const options = [...new Set((fields.options ?? []).map(oneLine).filter(Boolean))];
    if (options.length && !fields.by) throw new BadOptions("only the agent's comments have suggested answers");
    if (options.length > OPTIONS_MAX) throw new BadOptions(`at most ${OPTIONS_MAX} suggested answers`);
    if (options.some((o) => o.length > OPTION_MAX)) throw new BadOptions(`keep each suggested answer under ${OPTION_MAX} characters`);
    const comment: Comment = {
      n: ++this.last, id: fields.id, ...(quote ? { quote, prefix: fields.prefix ?? "", suffix: fields.suffix ?? "" } : {}),
      text, ...(fields.by ? { by: fields.by } : {}), ...(fields.from ? { from: fields.from } : {}), ...(options.length ? { options } : {}), status: "open", created: new Date().toISOString(),
    };
    this.comments.push(comment);
    this.save();
    const name = (a?: Author) => (a?.name ? oneLine(a.name).slice(0, 40) : undefined);
    const by = comment.by ? " by the agent" + (name(comment.by) ? ` (${name(comment.by)})` : "") : name(comment.from) ? ` by ${name(comment.from)}` : "";
    this.log(`${time()} comment #${comment.n}${by} on ${comment.id}${quote ? ` at ${quoted(quote, 80)}` : ""}: ${quoted(text, TEXT_MAX)}`, !comment.by);
    if (!comment.by) this.tag(comment);
    return comment;
  }

  /** Ask the tagger about the user's comment, after its change line has gone out, so a slow or failing tagger delays nothing. */
  private tag(comment: Comment): void {
    if (!this.tagger) return;
    const text = comment.text;
    this.tagger(comment).then(
      (tag) => {
        // Deleted, or edited again while the tagger was working.
        if (!tag || comment.text !== text || !this.comments.includes(comment)) return;
        comment.tag = tag;
        this.save();
      },
      () => {},
    );
  }

  /** A pause summary's `comment #3`, with the comment's tag if it has one: `comment #3 (small fix)`. */
  withTag(label: string): string {
    const n = /^comment #(\d+)$/.exec(label)?.[1];
    const tag = n === undefined ? undefined : this.comments.find((c) => c.n === Number(n))?.tag;
    return tag ? `${label} (${tag})` : label;
  }

  /** The user's comment, which only the user changes. */
  private usersComment(n: number): Comment {
    const comment = this.get(n);
    if (comment.by) throw new NotTheirs(`comment #${n} is the agent's`);
    return comment;
  }

  /** The agent's comment, still open, for the user to answer or dismiss. */
  private openAgentComment(n: number): Comment {
    const comment = this.get(n);
    if (!comment.by) throw new NotTheirs(`comment #${n} is the user's`);
    if (comment.status !== "open") throw new NotTheirs(`comment #${n} is already done`);
    return comment;
  }

  edit(n: number, text: string): Comment {
    const comment = this.usersComment(n);
    if (!text.trim()) throw new EmptyComment();
    if (comment.text === text.trim()) return comment;
    comment.text = text.trim();
    delete comment.tag;
    this.save();
    this.log(`${time()} comment #${n} edited: ${quoted(comment.text, TEXT_MAX)}`, true);
    this.tag(comment);
    return comment;
  }

  delete(n: number): void {
    this.usersComment(n);
    this.comments = this.comments.filter((c) => c.n !== n);
    this.save();
    this.log(`${time()} comment #${n} deleted`, true);
  }

  /** The user answers the agent's comment; the agent then acts on the answer and resolves it. */
  answer(n: number, text: string): Comment {
    const comment = this.openAgentComment(n);
    if (!text.trim()) throw new EmptyComment();
    if (comment.answer === text.trim()) return comment;
    comment.answer = text.trim();
    this.save();
    this.log(`${time()} comment #${n} answered by the user: ${quoted(comment.answer, TEXT_MAX)}`, true);
    return comment;
  }

  /** The user closes the agent's comment without asking for anything. */
  dismiss(n: number): Comment {
    const comment = this.openAgentComment(n);
    comment.status = "done";
    comment.dismissed = true;
    comment.resolved = new Date().toISOString();
    this.save();
    this.log(`${time()} comment #${n} dismissed by the user`, true);
    return comment;
  }

  /** The agent has dealt with the comment, with an optional note for the user. */
  resolve(n: number, reply?: string): Comment {
    const comment = this.get(n);
    comment.status = "done";
    comment.resolved = new Date().toISOString();
    if (reply?.trim()) comment.reply = reply.trim();
    else delete comment.reply;
    this.save();
    this.log(`${time()} comment #${n} marked done by the agent${comment.reply ? `: ${quoted(comment.reply, TEXT_MAX)}` : ""}`, false);
    return comment;
  }

  /** Remove the comments marked done; returns how many. */
  clearDone(): number {
    const before = this.comments.length;
    this.comments = this.comments.filter((c) => c.status === "open");
    if (this.comments.length !== before) this.save();
    return before - this.comments.length;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private save(): void {
    this.revision++;
    try {
      this.persist.save(JSON.stringify({ last: this.last, comments: this.comments }));
    } catch {
      // the comments still work in memory
    }
    for (const listener of this.listeners) listener();
  }
}
