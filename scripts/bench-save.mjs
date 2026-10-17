// Time saves on a large generated document:
//   npm run build && node scripts/bench-save.mjs [image MB] [saves] [paragraphs] [rows]
// Builds a file with a base64 image of about that size (0 for none) and thousands of paragraphs
// and table rows, then times edits through Document as the page makes them: the save, then the
// list of changes the page asks for after it.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { Document } from "../dist/src/server.js";

const mb = Number(process.argv[2] ?? 10);
const saves = Number(process.argv[3] ?? 10);
const paragraphs = Number(process.argv[4] ?? 3000);
const rows = Number(process.argv[5] ?? 2000);

const image = randomBytes(Math.round(mb * 1024 * 1024 * 0.75)).toString("base64");
const body = [
  `<h1>Big report</h1>`,
  `<figure><img src="data:image/png;base64,${image}" alt="chart"><figcaption>Chart</figcaption></figure>`,
  ...Array.from({ length: paragraphs }, (_, i) => `<p>Paragraph ${i} with <em>some</em> words in it and a bit more text to read.</p>`),
  `<table><tbody>`,
  ...Array.from({ length: rows }, (_, i) => `<tr><td>Row ${i}</td><td>${i * 3}</td><td>note ${i}</td></tr>`),
  `</tbody></table>`,
].join("\n");
const dir = mkdtempSync(join(tmpdir(), "inplace-bench-"));
const path = join(dir, "big.html");
writeFileSync(path, `<!doctype html><html><head><title>Big</title></head><body>\n${body}\n</body></html>\n`);

const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6;
let t = process.hrtime.bigint();
const doc = new Document(path, true, () => {}, dir);
doc.load();
console.log(`file ${(Buffer.byteLength(body) / 1e6).toFixed(1)} MB, first load ${ms(t).toFixed(0)} ms`);

const times = [];
const lists = [];
for (let i = 0; i < saves; i++) {
  const id = `p-${1 + i * 7}`;
  const n = 1 + i * 7 - 1;
  const old = `Paragraph ${n} with <em>some</em> words in it and a bit more text to read.`;
  t = process.hrtime.bigint();
  doc.saveBlock(id, old, old.replace("some", `edit ${i}`));
  times.push(ms(t));
  t = process.hrtime.bigint();
  doc.poll();
  doc.undoable();
  lists.push(ms(t));
}
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1].toFixed(0);
console.log(`save: median ${med(times)} ms (${times.map((x) => x.toFixed(0)).join(" ")})`);
console.log(`change list after save: median ${med(lists)} ms`);
rmSync(dir, { recursive: true });
