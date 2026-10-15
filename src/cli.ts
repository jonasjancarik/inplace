#!/usr/bin/env node
import { appendFileSync, existsSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { PauseCommand, PauseWatcher } from "./idle.js";
import { createInplaceServer, Document } from "./server.js";

const USAGE = `usage: inplace <file.html> [--port 8765] [--host 0.0.0.0] [--no-write-ids]
                           [--pause 5] [--log <file>] [--on-pause <command>]

Edit an HTML document in the browser while an agent edits the same file.

  --port <n>        port to listen on (default 8765)
  --host <addr>     address to listen on (default 0.0.0.0; use 127.0.0.1 to stay local)
  --no-write-ids    don't add data-id attributes to the file
                    (blocks without one can't be edited or commented on precisely)
  --pause <s>       after this many seconds without a change on the page, print one
                    "paused after …" line summing up the changes (default 5; 0 turns it off)
  --log <file>      also append every change line to this file
  --on-pause <cmd>  run this shell command each time the user pauses, with that pause's
                    change lines on stdin`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", default: "8765" },
    host: { type: "string", default: "0.0.0.0" },
    "no-write-ids": { type: "boolean", default: false },
    pause: { type: "string", default: "5" },
    log: { type: "string" },
    "on-pause": { type: "string" },
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
const pauseSeconds = Number(values.pause);
if (!(pauseSeconds >= 0)) {
  console.error("inplace: --pause takes a number of seconds");
  process.exit(2);
}
if (values["on-pause"] && !pauseSeconds) {
  console.error("inplace: --on-pause needs --pause to be more than 0");
  process.exit(2);
}

// Changes made on the page go to stdout (and the log file), so an agent running
// inplace in the background can read what the user did.
const logPath = values.log ? resolve(values.log) : undefined;
const print = (line: string) => {
  console.log(line);
  if (logPath) appendFileSync(logPath, line + "\n");
};
const onPause = values["on-pause"]
  ? new PauseCommand(values["on-pause"], { INPLACE_FILE: path }, print)
  : undefined;
const pauses = pauseSeconds
  ? new PauseWatcher(pauseSeconds * 1000, (summary, lines) => {
    print(summary);
    onPause?.run(lines);
  })
  : undefined;
const doc = new Document(path, !values["no-write-ids"], (line, byUser) => {
  print(line);
  if (byUser) pauses?.record(line);
});
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
  console.log("Changes made on the page are listed below.");
});
