import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Script } from "node:vm";

import { EDITOR_PARTS, readEditorScript } from "../src/editor-script.js";

const SOURCE = join(import.meta.dirname, "..", "..", "src", "editor");

test("every file in src/editor is part of the page's script, once", () => {
  const files = readdirSync(SOURCE).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")).map((f) => f.slice(0, -3));
  assert.deepEqual([...EDITOR_PARTS].sort(), files.sort());
  assert.equal(new Set(EDITOR_PARTS).size, EDITOR_PARTS.length);
});

test("the parts join into one classic script", () => {
  const script = readEditorScript();
  // Compiling catches a syntax error, a constant declared in two parts, and an import or export
  // (which would make a part a module that no longer shares the others' scope).
  assert.doesNotThrow(() => new Script(script, { filename: "editor.js" }));
  assert.match(script, /^\(\(\) => \{$/m);
  assert.match(script, /\}\)\(\);\n$/);
  assert.doesNotMatch(script, /^"use strict";$/m);
  assert.doesNotMatch(script, /sourceMappingURL/);
});
