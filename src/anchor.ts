// Finding the text a comment was about again after the document changed. Pure string
// work, so it runs in Node for the tests and, served as /__inplace/anchor.js, in the
// page. inplace searches inside one element's text (found by its data-id), not the
// whole page, so repeats are rare and the search is cheap.
//
// buildContext and findQuote are adapted from human-review's src/anchor-text.js
// (https://github.com/petergyang/human-review), MIT License, Copyright (c) 2026 Peter Yang.
// Permission is hereby granted, free of charge, to any person obtaining a copy of this
// software and associated documentation files, to deal in the Software without
// restriction, provided that the above copyright notice and this permission notice
// shall be included in all copies or substantial portions of the Software. THE
// SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

export const CONTEXT_PAD = 32;

/** The selected text and up to `pad` characters on each side of it. */
export interface QuoteContext {
  quote: string;
  prefix: string;
  suffix: string;
}

/** Capture the text from `start` to `end` with the text around it, so it can be found again after edits. */
export function buildContext(text: string, start: number, end: number, pad = CONTEXT_PAD): QuoteContext {
  return {
    prefix: text.slice(Math.max(0, start - pad), start),
    quote: text.slice(start, end),
    suffix: text.slice(end, Math.min(text.length, end + pad)),
  };
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function occurrences(text: string, quote: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) found.push(at);
  return found;
}

/** The occurrence whose surroundings best match the prefix and suffix. */
function bestHit(text: string, hits: number[], quote: string, prefix: string, suffix: string) {
  let best = hits[0];
  let bestScore = -1;
  for (const at of hits) {
    const before = text.slice(Math.max(0, at - prefix.length), at);
    const after = text.slice(at + quote.length, at + quote.length + suffix.length);
    const score = commonSuffixLength(prefix, before) + commonPrefixLength(suffix, after);
    if (score > bestScore) {
      bestScore = score;
      best = at;
    }
  }
  return { at: best, score: bestScore };
}

const collapse = (s: string) => s.replace(/\s+/g, " ");

/** Collapse whitespace runs, keeping a map from each kept character to its original index. */
function collapseWithMap(text: string): { flat: string; map: number[] } {
  let flat = "";
  const map: number[] = [];
  let pendingSpace = -1;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (pendingSpace === -1) pendingSpace = i;
      continue;
    }
    if (pendingSpace !== -1 && flat) {
      flat += " ";
      map.push(pendingSpace);
    }
    pendingSpace = -1;
    flat += text[i];
    map.push(i);
  }
  return { flat, map };
}

/**
 * Where `ctx.quote` is in `text`, using the prefix and suffix to choose between repeats,
 * and ignoring differences in whitespace if it isn't there exactly. Null when it's gone.
 */
export function findQuote(text: string, ctx: QuoteContext): { start: number; end: number; exact: boolean } | null {
  const quote = ctx.quote;
  if (!quote) return null;

  const hits = occurrences(text, quote);
  if (hits.length === 1) return { start: hits[0], end: hits[0] + quote.length, exact: true };
  if (hits.length > 1) {
    const { at, score } = bestHit(text, hits, quote, ctx.prefix, ctx.suffix);
    return { start: at, end: at + quote.length, exact: score > 0 };
  }

  // Reflowed whitespace (an agent rewrapping the source) leaves the words as they were:
  // match on whitespace-collapsed text and map the hit back to real offsets.
  const { flat, map } = collapseWithMap(text);
  const flatQuote = collapse(quote).trim();
  if (!flatQuote || !map.length) return null;
  const flatHits = occurrences(flat, flatQuote);
  if (!flatHits.length) return null;
  const { at } = bestHit(flat, flatHits, flatQuote, collapse(ctx.prefix), collapse(ctx.suffix));
  return { start: map[at], end: map[at + flatQuote.length - 1] + 1, exact: false };
}
