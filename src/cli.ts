#!/usr/bin/env node
import { appendFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { PauseCommand, PauseWatcher } from "./idle.js";
import { newToken, runMcpHttpServer, runMcpServer } from "./mcp.js";
import { createInplaceServer, Document, serverUrls } from "./server.js";

const USAGE = `usage: inplace <file.html> [--port 8765] [--host 127.0.0.1] [--no-write-ids]
                           [--pause 5] [--log <file>] [--on-pause <command>]
       inplace mcp [--pause 5] [--log <file>]
       inplace mcp --http [--port 8766] [--host 127.0.0.1] [--token <secret>] [--pause 5] [--log <file>]

Edit an HTML document in the browser while an agent edits the same file.

  --port <n>        port to listen on (default 8765)
  --host <addr>     address to listen on (default 127.0.0.1, this computer only; use 0.0.0.0
                    to open the page on other devices on your network)
  --no-write-ids    don't add data-id attributes to the file
                    (blocks without one can't be edited or commented on precisely)
  --pause <s>       after this many seconds without a change on the page, print one
                    "paused after …" line summing up the changes (default 5; 0 turns it off)
  --log <file>      also append every change line to this file
  --on-pause <cmd>  run this shell command each time the user pauses, with that pause's
                    change lines on stdin

inplace mcp runs an MCP server on stdin/stdout instead, with tools to open, read and edit a
document and read the changes, and a Claude Code channel event at each pause. Change lines go
to stderr and the --log file.

  --http            serve MCP over HTTP instead, at /mcp/<token>, for use through a tunnel
  --token <secret>  the token in that URL (default: $INPLACE_TOKEN, or a new random one)`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string" },
    host: { type: "string" },
    http: { type: "boolean", default: false },
    token: { type: "string" },
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

const pauseSeconds = Number(values.pause);
if (!(pauseSeconds >= 0)) {
  console.error("inplace: --pause takes a number of seconds");
  process.exit(2);
}
const logPath = values.log ? resolve(values.log) : undefined;
if (positionals[0] === "mcp" && values.http) {
  // A tunnel makes this reachable from the internet, so stay local and require a token.
  const port = Number(values.port ?? "8766");
  const host = values.host ?? "127.0.0.1";
  const token = values.token ?? process.env.INPLACE_TOKEN ?? newToken();
  runMcpHttpServer({ pauseSeconds, logPath, port, host, token }).then(
    (server) => {
      const actual = (server.address() as { port: number }).port;
      console.log(`inplace MCP server: http://${host === "0.0.0.0" ? "localhost" : host}:${actual}/mcp/${token}`);
      console.log("Point your tunnel at it and keep the URL secret: anyone with it can read and edit open documents.");
    },
    (e: NodeJS.ErrnoException) => {
      console.error(e.code === "EADDRINUSE" ? `inplace: port ${port} is already in use; try --port` : e.message);
      process.exit(1);
    },
  );
} else if (positionals[0] === "mcp") {
  runMcpServer({ pauseSeconds, logPath });
} else {
  serve();
}

/** The plain CLI: serve the file and print the changes to stdout. */
function serve(): void {
  const path = resolve(positionals[0]);
  if (!existsSync(path) || !statSync(path).isFile()) {
    console.error(`inplace: no such file: ${path}`);
    process.exit(1);
  }

  const port = Number(values.port ?? "8765");
  const host = values.host ?? "127.0.0.1";
  if (values["on-pause"] && !pauseSeconds) {
    console.error("inplace: --on-pause needs --pause to be more than 0");
    process.exit(2);
  }

  // Changes made on the page go to stdout (and the log file), so an agent running
  // inplace in the background can read what the user did.
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
  server.listen(port, host, () => {
    console.log(`Editing ${path}`);
    for (const url of serverUrls(port, host)) console.log(`  ${url}`);
    console.log("Changes made on the page are listed below.");
  });
}
