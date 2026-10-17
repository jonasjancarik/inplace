import assert from "node:assert/strict";
import { test } from "node:test";

import { assignIds, type Node, parse, parseTree, patchBlock } from "../src/htmldoc.js";

const B64 = "iVBORw0KGgoAAAANSUhEUgAA+/".repeat(200) + "=="; // longer than a run that gets left out
const doc = (body: string) => `<!doctype html><html><head><title>t</title></head><body>\n${body}\n</body></html>`;

/** A tree as plain data, to compare two of them. */
const plain = (node: Node): unknown => ({
  tag: node.tag, attrs: [...node.attrs], start: node.start, openEnd: node.openEnd, innerEnd: node.innerEnd, end: node.end,
  hasText: node.hasText, children: node.children.map(plain),
});

const cases: Record<string, string> = {
  "an image in a double-quoted value": `<p>Before</p><figure><img src="data:image/png;base64,${B64}" alt="x"><figcaption>Cap</figcaption></figure><p>After</p>`,
  "single-quoted and unquoted values": `<img src='data:image/png;base64,${B64}'><img src=${B64}><p>After</p>`,
  "several images": `<img src="data:,${B64}"><p>One</p><img src="data:,${B64}${B64}"><p>Two</p>`,
  "an image inside svg": `<svg><image href="data:image/png;base64,${B64}"/></svg><p>After</p>`,
  "an image inside a template": `<template><img src="data:,${B64}"></template><p>After</p>`,
  "a value with an entity": `<img src="a&amp;b${B64}"><p>After</p>`,
  "a value with a line break": `<img src="data:,\r\n${B64}"><p>After</p>`,
  "a run in text": `<p>${B64}</p><p>After</p>`,
  "a run in a script": `<script>const img = "${B64}";</script><p>After</p>`,
  "a run in a comment": `<!-- ${B64} --><p>After</p>`,
  "a run as an attribute name": `<p ${B64}>Text</p><p>After</p>`,
  "a run after an equals sign in a name": `<p ="${B64}">Text</p><p>After</p>`,
  "a run in a duplicate attribute": `<img src="x" src="${B64}"><p>After</p>`,
  "a run in an end tag": `<p>Text</p class="${B64}"><p>After</p>`,
  "an unclosed value": `<p>Text</p><img src="${B64}`,
};

for (const [name, body] of Object.entries(cases)) {
  test(`a file with ${name} parses the same as reading every character`, () => {
    const source = doc(body);
    assert.deepEqual(plain(parseTree(source)), plain(parseTree(source, false)));
  });
}

test("an embedded image keeps its full value", () => {
  const source = doc(`<img data-id="img-1" src="data:image/png;base64,${B64}">`);
  const img = parseTree(source).children[0].children[1].children[0];
  assert.equal(img.attrs.get("src"), `data:image/png;base64,${B64}`);
  assert.equal(source.slice(img.start, img.end), `<img data-id="img-1" src="data:image/png;base64,${B64}">`);
});

test("ids are added the same way next to an embedded image", () => {
  const source = doc(`<h1>Title</h1>\n<figure><img src="data:,${B64}"><figcaption>Cap</figcaption></figure>\n<p>Text</p>`);
  const { source: withIds, added } = assignIds(source);
  assert.equal(added, 4);
  assert.match(withIds, /<h1 data-id="h1-1">Title<\/h1>\n<figure data-id="figure-1"><img src="data:,iVBOR/);
  assert.match(withIds, /<figcaption data-id="figcaption-1">Cap<\/figcaption><\/figure>\n<p data-id="p-1">Text<\/p>/);
});

test("a remembered tree is never used for different text", () => {
  const a = doc(`<p data-id="p-1">One</p>`);
  const b = doc(`<p data-id="p-1">Two</p>`);
  assert.equal(parse(a), parse(a));
  assert.notEqual(parse(a), parse(b));
  assert.equal(patchBlock(a, "p-1", "One", "Uno"), doc(`<p data-id="p-1">Uno</p>`));
  assert.equal(patchBlock(b, "p-1", "Two", "Dos"), doc(`<p data-id="p-1">Dos</p>`));
});
