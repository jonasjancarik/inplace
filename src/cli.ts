#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { get, request } from "node:http";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { AgentStatus } from "./agent.js";
import { AGENT_GUIDE_PATH } from "./guide.js";
import { PauseCommand, PauseWatcher } from "./idle.js";
import { newToken, runMcpHttpServer, runMcpServer } from "./mcp.js";
import { allowedHostName, createInplaceServer, Document, serverUrls } from "./server.js";
import { ChangeFeed } from "./wait.js";

const USAGE = `usage: inplace <file.html> [--port 8765] [--host 127.0.0.1] [--allow-host <name>] [--no-write-ids]
                           [--pause 5] [--log <file>] [--on-pause <command>]
       inplace wait [--port 8765] [--timeout <seconds>] [--after <n>]
       inplace comments [--port 8765] [--all]
       inplace resolve <n> [--reply <text>] [--port 8765]
       inplace comment <data-id> <text> [--quote <text>] [--option <answer>]... [--port 8765]
       inplace guide
       inplace mcp [--allow-host <name>] [--pause 5] [--log <file>]
       inplace mcp --http [--port 8766] [--host 127.0.0.1] [--token <secret>] [--allow-host <name>]
                          [--pause 5] [--log <file>]

Edit an HTML document in the browser while an agent edits the same file.

  --port <n>        port to listen on (default 8765)
  --host <addr>     address to listen on (default 127.0.0.1, this computer only; use 0.0.0.0
                    to open the page on other devices on your network)
  --allow-host <name>
                    also let the page be opened by this name, such as a Tailscale MagicDNS
                    name (mymac.tail1234.ts.net); repeat for more names. Without it, only
                    localhost, this computer's own name and IP addresses work
  --no-write-ids    don't add data-id attributes to the file
                    (blocks without one can't be edited or commented on precisely)
  --pause <s>       after this many seconds without a change on the page, print one
                    "paused after …" line summing up the changes (default 5; 0 turns it off)
  --log <file>      also append every change line to this file
  --on-pause <cmd>  run this shell command each time the user pauses, with that pause's
                    change lines on stdin

inplace wait waits for the user's next pause in the inplace already running on --port, prints
that pause's change lines and the number to pass as --after next time, as JSON, and exits. Without
--after, it carries on from where the previous wait stopped.

  --timeout <s>     give up after this many seconds: print {"status":"timeout"} and exit with code 3
  --after <n>       return the lines after line n (the "next" a previous wait printed); if
                    inplace has restarted since, the lines since the restart

inplace comments prints the open comments the user left on the page, as JSON (--all: also
those marked done). inplace resolve marks comment n as done once you've dealt with it; --reply
adds a short note the user sees under the comment. inplace comment leaves your own comment on the
element with that data-id, for the user to answer or dismiss; --quote puts it on those words inside
the element, and --option (up to three times) suggests an answer the user can pick with one click.

inplace guide prints the instructions an agent needs to work on a document with you.

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
    "allow-host": { type: "string", multiple: true, default: [] },
    http: { type: "boolean", default: false },
    token: { type: "string" },
    "no-write-ids": { type: "boolean", default: false },
    pause: { type: "string", default: "5" },
    log: { type: "string" },
    "on-pause": { type: "string" },
    timeout: { type: "string" },
    after: { type: "string" },
    reply: { type: "string" },
    quote: { type: "string" },
    option: { type: "string", multiple: true, default: [] },
    all: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const ARGUMENTS: Record<string, number> = { resolve: 2, comment: 3 };
if (values.help || positionals.length !== (ARGUMENTS[positionals[0]] ?? 1)) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}

const pauseSeconds = Number(values.pause);
if (!(pauseSeconds >= 0)) {
  console.error("inplace: --pause takes a number of seconds");
  process.exit(2);
}
const logPath = values.log ? resolve(values.log) : undefined;
const allowHosts = values["allow-host"].map((value) => {
  const name = allowedHostName(value);
  if (name === null) {
    console.error(`inplace: --allow-host takes a host name without a port, like mymac.tail1234.ts.net (got ${JSON.stringify(value)})`);
    process.exit(2);
  }
  return name;
});
if (positionals[0] === "wait") {
  waitForPause();
} else if (positionals[0] === "comments" || positionals[0] === "resolve" || positionals[0] === "comment") {
  comments();
} else if (positionals[0] === "guide") {
  process.stdout.write(readFileSync(AGENT_GUIDE_PATH, "utf8"));
} else if (positionals[0] === "mcp" && values.http) {
  // A tunnel makes this reachable from the internet, so stay local and require a token.
  const port = Number(values.port ?? "8766");
  const host = values.host ?? "127.0.0.1";
  const token = values.token ?? process.env.INPLACE_TOKEN ?? newToken();
  runMcpHttpServer({ pauseSeconds, logPath, allowHosts, port, host, token }).then(
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
  runMcpServer({ pauseSeconds, logPath, allowHosts });
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
  // stdout and the log file can be read without inplace knowing.
  const agent = new AgentStatus({ unseenReaders: true });
  const onPause = values["on-pause"]
    ? new PauseCommand(values["on-pause"], { INPLACE_FILE: path }, print, (running) => agent.commandRunning(running))
    : undefined;
  // The same lines, numbered, for `inplace wait`.
  const feed = pauseSeconds ? new ChangeFeed() : undefined;
  const pauses = pauseSeconds
    ? new PauseWatcher(pauseSeconds * 1000, (summary, lines) => {
      agent.paused();
      print(summary);
      feed?.add(summary, true);
      onPause?.run(lines);
    })
    : undefined;
  const doc = new Document(path, !values["no-write-ids"], (line, byUser, ids = []) => {
    print(line);
    feed?.add(line);
    if (byUser) {
      agent.edited(ids);
      pauses?.record(line);
    }
  });
  setInterval(() => doc.poll(), 250);

  const server = createInplaceServer(doc, { feed, agent, allowHosts });
  server.on("error", (e: NodeJS.ErrnoException) => {
    console.error(e.code === "EADDRINUSE" ? `inplace: port ${port} is already in use; try --port` : e.message);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`Editing ${path}`);
    for (const url of serverUrls(port, host, allowHosts)) console.log(`  ${url}`);
    console.log("Changes made on the page are listed below.");
  });
}

/**
 * `inplace wait`: ask the running server for the next pause and print it. A dropped
 * connection (say, inplace restarting) is retried a few times before giving up.
 */
function waitForPause(): void {
  const port = Number(values.port ?? "8765");
  const host = values.host ?? "127.0.0.1";
  const timeout = values.timeout === undefined ? undefined : Number(values.timeout);
  const after = values.after === undefined ? undefined : Number(values.after);
  if ((timeout !== undefined && !(timeout >= 0)) || (after !== undefined && !(Number.isInteger(after) && after >= 0))) {
    console.error("inplace: --timeout takes a number of seconds and --after a whole number");
    process.exit(2);
  }
  const deadline = timeout === undefined ? undefined : Date.now() + timeout * 1000;
  // Wait for stdout to be written before exiting, or a piped reader can get nothing.
  const finish = (output: unknown, code: number) =>
    process.stdout.write(JSON.stringify(output, null, 2) + "\n", () => process.exit(code));
  let failures = 0;
  let connected = false;

  const attempt = () => {
    const query = new URLSearchParams();
    if (after !== undefined) query.set("after", String(after));
    if (deadline !== undefined) query.set("timeout", String(Math.max(0, deadline - Date.now()) / 1000));
    const req = get({ host, port, path: `/__inplace/wait?${query}`, headers: { host: `localhost:${port}` } }, (res) => {
      connected = true;
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => (body += d));
      res.on("error", retry);
      res.on("end", () => {
        let reply: { status?: string; error?: string };
        try {
          reply = JSON.parse(body);
        } catch {
          return retry(new Error("the connection closed before the answer was complete"));
        }
        if (res.statusCode !== 200) {
          console.error(`inplace: ${reply.error ?? `the server answered ${res.statusCode}`}`);
          process.exit(1);
        }
        finish(reply, reply.status === "timeout" ? 3 : 0);
      });
    });
    req.on("error", retry);
  };

  function retry(e: Error): void {
    failures++;
    const late = deadline !== undefined && Date.now() >= deadline;
    if (late && connected) {
      finish({ status: "timeout", ...(after === undefined ? {} : { next: after }) }, 3);
      return;
    }
    if (failures > 5 || late) {
      console.error(`inplace: can't reach inplace on port ${port} (${e.message}). Is it running?`);
      process.exit(1);
    }
    setTimeout(attempt, 1000);
  }

  attempt();
}

/** `inplace comments`, `inplace resolve` and `inplace comment`: one request to the running server. */
function comments(): void {
  const port = Number(values.port ?? "8765");
  const host = values.host ?? "127.0.0.1";
  const [command, ...rest] = positionals;
  const n = Number(rest[0]);
  if (command === "resolve" && !(Number.isInteger(n) && n > 0)) {
    console.error("inplace: resolve takes the comment's number, e.g. inplace resolve 3");
    process.exit(2);
  }
  const body = command === "resolve" ? JSON.stringify({ action: "resolve", n, ...(values.reply ? { reply: values.reply } : {}) })
    : command === "comment" ? JSON.stringify({ action: "add", by: "agent", id: rest[0], text: rest[1],
      ...(values.quote ? { quote: values.quote } : {}), ...(values.option.length ? { options: values.option } : {}) })
    : undefined;
  const req = request({
    host, port, method: body ? "POST" : "GET",
    path: body ? "/__inplace/comment" : `/__inplace/comments${values.all ? "" : "?open=1"}`,
    headers: { host: `localhost:${port}`, ...(body ? { "content-type": "application/json" } : {}) },
  }, (res) => {
    let text = "";
    res.setEncoding("utf8");
    res.on("data", (d: string) => (text += d));
    res.on("end", () => {
      let reply: { error?: string; comments?: unknown; comment?: { n: number } };
      try {
        reply = JSON.parse(text);
      } catch {
        reply = {};
      }
      if (res.statusCode !== 200) {
        console.error(`inplace: ${reply.error ?? `the server answered ${res.statusCode}`}`);
        process.exit(1);
      }
      const output = command === "resolve" ? `Marked comment #${n} as done.`
        : command === "comment" ? `Added comment #${reply.comment?.n} on ${rest[0]}.`
        : JSON.stringify(reply.comments, null, 2);
      process.stdout.write(output + "\n", () => process.exit(0));
    });
  });
  req.on("error", (e) => {
    console.error(`inplace: can't reach inplace on port ${port} (${e.message}). Is it running?`);
    process.exit(1);
  });
  req.end(body);
}
