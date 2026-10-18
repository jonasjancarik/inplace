// Optional tags for the user's comments from Jev, TypeSafe AI's classification model
// (https://docs.typesafe.ai/api), so the agent can see at a glance which comments are
// small fixes and which need more thought. Off unless a key is set.

import type { CommentTag, CommentTagger, TagRequest } from "./comments.js";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Long elements are cut, so only the part around a comment is sent. */
const ELEMENT_MAX = 2000;
const TEXT_MAX = 1000;

/** Each tag as Jev sees it: an option name without spaces, with the description it picks by. */
const CRITERIA: Record<string, { tag: CommentTag; description: string }> = {
  small_fix: { tag: "small fix", description: "Fix spelling, grammar, punctuation or a single word, with the change spelled out or obvious" },
  rewrite: { tag: "rewrite", description: "Reword, shorten, lengthen, restructure or change the tone of existing text" },
  content: { tag: "content", description: "Add, remove, correct or check facts, figures, names or sections" },
  question: { tag: "question", description: "Ask something or ask for an opinion, without asking for a change yet" },
  layout: { tag: "layout", description: "Change a chart, table, figure, styling, order or layout" },
};

export interface JevOptions {
  /** Give up on a comment after this long, leaving it untagged (default 1000 ms). */
  timeoutMs?: number;
  /** Store a tag only when Jev is at least this sure (default 0.9). */
  minConfidence?: number;
  model?: string;
  /** Told once, the first time a request fails. */
  warn?: (message: string) => void;
  fetch?: typeof globalThis.fetch;
}

const clip = (text: string, max: number) => (text.length <= max ? text : text.slice(0, max - 1) + "…");

/** A tagger that asks Jev. It never rejects: on any failure the comment stays untagged. */
export function jevTagger(key: string, options: JevOptions = {}): CommentTagger {
  const {
    timeoutMs = 1000, minConfidence = 0.9, model = "jev-latest",
    warn = (message) => process.stderr.write(message + "\n"), fetch = globalThis.fetch,
  } = options;
  let warned = false;
  const fail = (why: string) => {
    if (!warned) warn(`inplace: couldn't tag a comment with Jev (${why}); comments carry on without tags.`);
    warned = true;
    return undefined;
  };

  return async ({ text, quote, element }: TagRequest) => {
    const body = {
      model,
      state: {
        comment: clip(text, TEXT_MAX),
        ...(quote ? { selected_text: clip(quote, TEXT_MAX) } : {}),
        element_text: clip(element, ELEMENT_MAX),
      },
      questions: {
        kind: {
          type: "choice",
          instructions: "A reader left this comment on part of a document they are editing with an AI agent. What kind of change are they asking for?",
          criteria: Object.fromEntries(Object.entries(CRITERIA).map(([name, { description }]) => [name, description])),
        },
      },
    };
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return fail((e as Error).name === "TimeoutError" ? `no answer within ${timeoutMs} ms` : (e as Error).message);
    }
    if (!res.ok) return fail(`HTTP ${res.status}${res.status === 401 ? ", check INPLACE_JEV_KEY" : ""}`);
    try {
      const answer = (await res.json())?.answers?.kind;
      const picked = CRITERIA[answer?.choice];
      if (!picked) return fail("an answer it didn't expect");
      return typeof answer.confidence === "number" && answer.confidence >= minConfidence ? picked.tag : undefined;
    } catch {
      return fail("an answer that isn't JSON");
    }
  };
}
