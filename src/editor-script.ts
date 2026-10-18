// The editing script the server adds to the page. Its source is split across src/editor/*.ts.
// Those files are plain scripts, not modules: they share one scope, without imports or exports,
// so TypeScript checks them as the single script they become. Here the compiled parts are put
// back together, in this order, inside one function, so nothing leaks into the page's globals.
// The order matters: each part's top-level statements run in turn when the page loads, and a
// part may only use another part's constants at load time if that part comes earlier.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EDITOR_DIR = join(dirname(fileURLToPath(import.meta.url)), "editor");

export const EDITOR_PARTS = [
  "setup",
  "util",
  "styles",
  "status",
  "blocks",
  "saving",
  "formatting",
  "drag",
  "structure",
  "undo",
  "diff",
  "words",
  "tooltip",
  "reload",
  "agent-changes",
  "stash",
  "agent-status",
  "comments",
  "changes",
  "review",
  "authors",
  "startup",
];

const HEADER = `// In-place editing for one HTML document served by \`inplace\`.
// Only blocks the server marked with data-id are editable, and only their text:
// structure, styling and generated parts stay as they are in the file.
// Built from src/editor/*.ts in the inplace repository.
`;

/** The compiled parts of the editor as one classic script. */
export function readEditorScript(dir = EDITOR_DIR): string {
  // TypeScript starts every compiled script with "use strict"; the editor has always run as
  // ordinary (sloppy) script code, and a directive in the middle of the function would do nothing.
  const parts = EDITOR_PARTS.map((name) => readFileSync(join(dir, `${name}.js`), "utf8").replace(/^"use strict";\n/, ""));
  return `${HEADER}(() => {\n${parts.join("\n")}})();\n`;
}
