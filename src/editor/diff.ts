// --- word-level diff ---
// Splits text into words, runs of spaces and punctuation marks, so "laundry,"
// and "laundry daily," share the word and the comma.
const tokenize = (text: string) => text.split(/(\s+|[.,;:!?()\[\]"\u201c\u201d])/).filter(Boolean);
const isSpace = (t: string) => /^\s+$/.test(t);
// Any two runs of spaces or line breaks count as the same.
const same = (x: string, y: string) => x === y || (isSpace(x) && isSpace(y));

// Before \u2192 after as a list of runs: { same: [tokens] } for unchanged text
// and { gone: [tokens], added: [tokens] } for each changed stretch.
type SameRun = { same: string[]; gone?: undefined; added?: undefined };
type ChangeRun = { same?: undefined; gone: string[]; added: string[] };
type Run = SameRun | ChangeRun;

function diffWords(before: string, after: string): Run[] {
  const a = tokenize(before), b = tokenize(after);
  let p = 0;
  while (p < a.length && p < b.length && same(a[p], b[p])) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && same(a[a.length - 1 - q], b[b.length - 1 - q])) q++;
  const A = a.slice(p, a.length - q), B = b.slice(p, b.length - q);
  const ops: [string, string][] = []; // [kind, token], kind is "=", "-" or "+"
  if (A.length * B.length > 60000) {
    // Too long to compare word by word quickly: show it as one replacement.
    for (const t of A) ops.push(["-", t]);
    for (const t of B) ops.push(["+", t]);
  } else {
    // Longest common subsequence of the tokens in the middle.
    const len = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--)
      for (let j = B.length - 1; j >= 0; j--)
        len[i][j] = same(A[i], B[j]) ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
    let i = 0, j = 0;
    while (i < A.length || j < B.length) {
      if (i < A.length && j < B.length && same(A[i], B[j])) { ops.push(["=", B[j++]]); i++; }
      else if (j < B.length && (i === A.length || len[i][j + 1] >= len[i + 1][j])) ops.push(["+", B[j++]]);
      else ops.push(["-", A[i++]]);
    }
  }
  const runs: Run[] = [];
  const push = (kind: string, t: string) => {
    const last = runs.at(-1);
    if (kind === "=") {
      if (last?.same) last.same.push(t);
      else runs.push({ same: [t] });
    } else {
      const run = last && !last.same ? last : (runs.push({ gone: [], added: [] }), runs.at(-1) as ChangeRun);
      (kind === "-" ? run.gone : run.added).push(t);
    }
  };
  for (const t of b.slice(0, p)) push("=", t);
  for (const [kind, t] of ops) push(kind, t);
  for (const t of b.slice(b.length - q)) push("=", t);
  // A space, a comma or one short word left between two changes reads
  // better as part of one larger change: "Two beds" \u2192 "Three cots", not
  // "Two" \u2192 "Three" + "beds" \u2192 "cots".
  for (let k = 1; k < runs.length - 1; k++) {
    const run = runs[k];
    if (!run.same || runs[k - 1].same || runs[k + 1].same) continue;
    const words = run.same.filter((t) => !isSpace(t));
    if (words.length > 1 || (words.length === 1 && words[0].length > 3 && /\w/.test(words[0]))) continue;
    const prev = runs[k - 1] as ChangeRun, next = runs[k + 1] as ChangeRun;
    prev.gone.push(...run.same, ...next.gone);
    prev.added.push(...run.same, ...next.added);
    runs.splice(k, 2);
    k--;
  }
  return runs;
}
