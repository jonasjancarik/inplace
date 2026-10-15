#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { createInplaceServer, Document } from "./server.js";

const USAGE = `usage: inplace <file.html> [--port 8765] [--host 0.0.0.0] [--no-write-ids]

Edit an HTML document in the browser while an agent edits the same file.

  --port <n>        port to listen on (default 8765)
  --host <addr>     address to listen on (default 0.0.0.0; use 127.0.0.1 to stay local)
  --no-write-ids    don't add data-id attributes to the file
                    (blocks without one can't be edited or commented on precisely)`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", default: "8765" },
    host: { type: "string", default: "0.0.0.0" },
    "no-write-ids": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || positionals.length !== 1) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}

const path = resolve(positionals[0]);
if (!existsSync(path) || !statSync(path).isFile()) {
  console.error(`inplace: no such file: ${path}`);
  process.exit(1);
}

const port = Number(values.port);
const doc = new Document(path, !values["no-write-ids"]);
setInterval(() => doc.poll(), 250);

const server = createInplaceServer(doc);
server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `inplace: port ${port} is already in use; try --port` : e.message);
  process.exit(1);
});
server.listen(port, values.host, () => {
  const host = hostname().replace(/\.local$/, "");
  console.log(`Editing ${path}`);
  console.log(`  http://localhost:${port}/`);
  if (values.host === "0.0.0.0") console.log(`  http://${host}.local:${port}/`);
});
