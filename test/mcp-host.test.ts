import assert from "node:assert/strict";
import { createServer } from "node:http";
import { type AddressInfo } from "node:net";
import { test } from "node:test";

import { createMcpHandler, DOCUMENT_INFO_TOOL, DOCUMENT_TOOLS, type HostTool, type McpHandlerOptions } from "../src/index.js";
import { hostDocument } from "./host-document.js";

/** The handler mounted the way a host would, on its own server, with a client that speaks JSON-RPC to it. */
async function mount(options?: McpHandlerOptions) {
  const target = hostDocument();
  const handler = createMcpHandler(target, options);
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => handler(req, res, Buffer.concat(chunks).toString("utf8")));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  let id = 0;
  const client = () => {
    let session: string | undefined;
    const rpc = async (method: string, params: Record<string, unknown> = {}) => {
      const res = await fetch(url, {
        method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        headers: { "Content-Type": "application/json", ...(session ? { "Mcp-Session-Id": session } : {}) },
      });
      session ??= res.headers.get("mcp-session-id") ?? undefined;
      return (await res.json()) as Record<string, any>;
    };
    const tool = async (name: string, args: Record<string, unknown> = {}) => {
      const reply = await rpc("tools/call", { name, arguments: args });
      return { text: reply.result.content[0].text as string, isError: reply.result.isError === true };
    };
    return { rpc, tool, init: () => rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } }) };
  };
  return { target, url, client, close: () => server.close() };
}

test("serves a document's tools without opening or closing, and the guide once on the first call", async () => {
  const host = await mount();
  try {
    const agent = host.client();
    const init = await agent.init();
    assert.match(init.result.instructions, /report\.html/);
    assert.doesNotMatch(init.result.instructions, /open_document/);
    assert.deepEqual(init.result.capabilities, { tools: {} }, "no channel events over HTTP");

    const { result } = await agent.rpc("tools/list");
    assert.deepEqual(result.tools.map((t: { name: string }) => t.name),
      ["get_edits", "wait_for_edits", "read_document", "replace_element", "find_replace", "get_comments", "resolve_comment", "add_comment", "document_info"]);

    const info = await agent.tool("document_info");
    assert.match(info.text, /Document: report\.html\nOpen it at: https:\/\/docs\.example\.com\/d\/1/);
    assert.match(info.text, /# Working on a document with inplace/, "the first call carries the agent guide");
    const read = await agent.tool("read_document", { id: "p-1" });
    assert.equal(read.text, '<p data-id="p-1">Ten trees</p>', "and only the first");

    assert.ok((await agent.tool("open_document", { path: "x.html" })).isError);
    const replaced = await agent.tool("replace_element", { id: "p-1", part: "inner", expected: "Ten trees", html: "Twelve trees" });
    assert.ok(!replaced.isError, replaced.text);
    assert.equal(host.target.doc.source("p-1"), '<p data-id="p-1">Twelve trees</p>');
    const stale = await agent.tool("replace_element", { id: "p-1", part: "inner", expected: "Ten trees", html: "x" });
    assert.ok(stale.isError);

    const other = await agent.tool("add_comment", { id: "p-2", text: "Is it two or three?" });
    assert.equal(other.text, "Added comment #1 on p-2.");
    assert.match((await agent.tool("get_comments")).text, /Is it two or three\?/);
  } finally {
    host.close();
  }
});

test("two clients on one document each follow the user's edits through their own session", async () => {
  const host = await mount({ guide: false });
  try {
    const [a, b] = [host.client(), host.client()];
    await a.init();
    await b.init();
    await a.tool("document_info");
    await b.tool("document_info");
    const waiting = [a.tool("wait_for_edits", { timeout_seconds: 5 }), b.tool("wait_for_edits", { timeout_seconds: 5 })];
    host.target.doc.saveBlock("p-1", "Ten trees", "Twelve trees");
    for (const { text } of await Promise.all(waiting)) assert.match(text, /Twelve trees[\s\S]*paused after/);
    host.target.doc.saveBlock("p-2", "Two benches", "Three benches");
    assert.match((await a.tool("get_edits")).text, /Three benches/);
    assert.match((await b.tool("get_edits")).text, /Three benches/);
    assert.equal((await a.tool("get_edits")).text, "No changes since the last call.");
  } finally {
    host.close();
  }
});

test("offers only the tools the host lists, and the host's own", async () => {
  const echo: HostTool = {
    name: "search_sources", description: "Search the project's uploads.", inputSchema: { type: "object", properties: {} },
    run: (args, { client }) => `found ${JSON.stringify(args)} for ${client ? "a session" : "nobody"}`,
  };
  const host = await mount({ tools: ["read_document", "get_edits"], extraTools: [echo], guide: false });
  try {
    const agent = host.client();
    await agent.init();
    const names = (await agent.rpc("tools/list")).result.tools.map((t: { name: string }) => t.name);
    assert.deepEqual(names, ["get_edits", "read_document", "search_sources"]);
    assert.equal((await agent.tool("search_sources", { q: "trees" })).text, 'found {"q":"trees"} for a session');
    const left = await agent.tool("find_replace", { find: "Ten", replace: "Eleven", all: false });
    assert.ok(left.isError, "a tool left out can't be called");
    assert.match(left.text, /unknown tool/);
  } finally {
    host.close();
  }
});

test("refuses tool lists that name a tool twice or one that doesn't exist", () => {
  const target = hostDocument();
  const tool: HostTool = { name: "get_edits", description: "", inputSchema: {}, run: () => "" };
  assert.throws(() => createMcpHandler(target, { extraTools: [tool] }), /already a tool/);
  assert.throws(() => createMcpHandler(target, { tools: ["open_document"] }), /no tool called/);
});

test("a request that isn't a POST gets a 405, and a bad body a 400", async () => {
  const host = await mount();
  try {
    assert.equal((await fetch(host.url)).status, 405);
    assert.equal((await fetch(host.url, { method: "POST", body: "{" })).status, 400);
    const note = await fetch(host.url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    assert.equal(note.status, 202);
  } finally {
    host.close();
  }
});

test("the exported tool definitions are what the handler offers", async () => {
  const host = await mount({ guide: false });
  try {
    const listed = (await host.client().rpc("tools/list")).result.tools;
    assert.deepEqual(listed, JSON.parse(JSON.stringify([...DOCUMENT_TOOLS, DOCUMENT_INFO_TOOL])));
  } finally {
    host.close();
  }
});

test("the by option names the agent in the marks and on its comments", async () => {
  const host = await mount({ by: { id: "agent-7", name: "Maya's agent" } });
  try {
    const agent = host.client();
    await agent.init();
    await agent.tool("replace_element", { id: "p-1", part: "inner", expected: "Ten trees", html: "Twelve trees" });
    const named = { kind: "agent", id: "agent-7", name: "Maya's agent" };
    assert.deepEqual(host.target.doc.authorMarks()["p-1"].by, named);
    await agent.tool("add_comment", { id: "p-2", text: "Is it two or three?" });
    assert.deepEqual(host.target.doc.comments.list()[0].by, named);
  } finally {
    host.close();
  }
});
