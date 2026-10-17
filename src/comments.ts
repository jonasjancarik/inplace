// Comments on the page, kept outside the document until they've been dealt with. Most are
// the user's requests to the agent; the agent can also leave its own, for the user to answer
// or dismiss. Each change is also a change line, so the agent hears about comments every
// way it hears about edits.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Comment {
  n: number; // unique for the life of the comments file
  id: string; // data-id of the element the comment is on
  quote?: string; // the selected text, if the comment is on part of the element's text
  prefix?: string;
  suffix?: string;
  text: string;
  by?: "agent"; // left by the agent; without it, by the user
  options?: string[]; // answers the agent suggests for its comment, for the user to pick with one click
  answer?: string; // the user's answer to the agent's comment
  dismissed?: boolean; // the user closed the agent's comment without asking for anything
  status: "open" | "done";
  created: string; // ISO time
  resolved?: string;
  reply?: string; // the agent's note to the user when it resolved the comment
}

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

  /** `log` gets one change line per change; `byUser` is false for the agent resolving a comment. */
  constructor(readonly path: string, readonly log: (line: string, byUser: boolean) => void = () => {}) {
    try {
      const saved = JSON.parse(readFileSync(path, "utf8"));
      this.comments = saved.comments ?? [];
      this.last = saved.last ?? Math.max(0, ...this.comments.map((c) => c.n));
    } catch {
      // no comments yet
    }
  }

  /** Open comments, or all of them, oldest first. */
  list(includeDone = true): Comment[] {
    return this.comments.filter((c) => includeDone || c.status === "open");
  }

  get(n: number): Comment {
    const comment = this.comments.find((c) => c.n === n);
    if (!comment) throw new CommentNotFound(`no comment #${n}`);
    return comment;
  }

  add(fields: { id: string; text: string; quote?: string; prefix?: string; suffix?: string; by?: "agent"; options?: string[] }): Comment {
    const text = fields.text.trim();
    if (!text) throw new EmptyComment();
    const quote = fields.quote?.trim() ? fields.quote : undefined;
    const options = [...new Set((fields.options ?? []).map(oneLine).filter(Boolean))];
    if (options.length && !fields.by) throw new BadOptions("only the agent's comments have suggested answers");
    if (options.length > OPTIONS_MAX) throw new BadOptions(`at most ${OPTIONS_MAX} suggested answers`);
    if (options.some((o) => o.length > OPTION_MAX)) throw new BadOptions(`keep each suggested answer under ${OPTION_MAX} characters`);
    const comment: Comment = {
      n: ++this.last, id: fields.id, ...(quote ? { quote, prefix: fields.prefix ?? "", suffix: fields.suffix ?? "" } : {}),
      text, ...(fields.by ? { by: fields.by } : {}), ...(options.length ? { options } : {}), status: "open", created: new Date().toISOString(),
    };
    this.comments.push(comment);
    this.save();
    const by = comment.by ? " by the agent" : "";
    this.log(`${time()} comment #${comment.n}${by} on ${comment.id}${quote ? ` at ${quoted(quote, 80)}` : ""}: ${quoted(text, TEXT_MAX)}`, !comment.by);
    return comment;
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
    this.save();
    this.log(`${time()} comment #${n} edited: ${quoted(comment.text, TEXT_MAX)}`, true);
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
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ last: this.last, comments: this.comments }), "utf8");
      renameSync(tmp, this.path);
    } catch {
      // the comments still work in memory
    }
    for (const listener of this.listeners) listener();
  }
}
