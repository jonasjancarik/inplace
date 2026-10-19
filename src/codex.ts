// The Codex hook that passes the user's comments to Codex while it's busy (see "Passing
// comments to Codex while it works" in the README): finding it in Codex's hooks.json, adding it
// there, and telling when inplace was started by Codex.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The hooks file Codex reads for the user, in `$CODEX_HOME` (default `~/.codex`). */
export function codexHooksPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CODEX_HOME || join(homedir(), ".codex"), "hooks.json");
}

/** Whether Codex started this process: Codex sets `CODEX_THREAD_ID` in its shell, and names itself over MCP. */
export function startedByCodex(env: NodeJS.ProcessEnv = process.env, mcpClient?: string): boolean {
  return Boolean(env.CODEX_THREAD_ID) || mcpClient === "codex-mcp-client";
}

/** What the hook runs: one curl call, silent when inplace has nothing new or isn't running. */
export function hookCommand(port = 8765): string {
  return `curl -sf --max-time 1 'http://localhost:${port}/__inplace/news?for=codex-hook' || true`;
}

type HookEntry = { matcher?: string; hooks?: { type?: string; command?: string; timeout?: number }[] };
type HooksFile = { hooks?: Record<string, HookEntry[] | undefined> };

/** Whether the file has a PostToolUse hook asking the inplace on `port` for news. */
export function hasInplaceHook(path: string, port = 8765): boolean {
  const hooks = readHooks(path)?.hooks?.PostToolUse ?? [];
  const asks = new RegExp(`localhost:${port}/__inplace/news\\b`);
  return hooks.some((entry) => entry.hooks?.some((hook) => asks.test(hook.command ?? "")));
}

/**
 * Add the hook for `port`, keeping everything else in the file, and back the file up first.
 * Returns "present" when it's already there, and throws when the file isn't readable JSON.
 */
export function addInplaceHook(path: string, port = 8765): { result: "added" | "present"; backup?: string } {
  if (hasInplaceHook(path, port)) return { result: "present" };
  const exists = existsSync(path);
  const file = exists ? readHooks(path) : {};
  if (!file || typeof file !== "object" || Array.isArray(file)) throw new Error(`${path} isn't a JSON object, so it was left as it is`);
  file.hooks ??= {};
  (file.hooks.PostToolUse ??= []).push({ matcher: ".*", hooks: [{ type: "command", command: hookCommand(port), timeout: 5 }] });

  let backup: string | undefined;
  if (exists) {
    // Never over an earlier backup, such as one made a moment ago for another port.
    const stamp = `${path}.bak-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-inplace`;
    backup = stamp;
    for (let n = 1; existsSync(backup); n++) backup = `${stamp}-${n}`;
    copyFileSync(path, backup);
  } else {
    mkdirSync(dirname(path), { recursive: true });
  }
  // Written beside it and moved over it, so Codex never reads half a file.
  const tmp = `${path}.inplace-tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
  return { result: "added", ...(backup ? { backup } : {}) };
}

/**
 * The line an agent gets when Codex started inplace and the hook for this port is missing,
 * or undefined.
 */
export function codexHookHint(port = 8765, env: NodeJS.ProcessEnv = process.env, mcpClient?: string): string | undefined {
  if (!startedByCodex(env, mcpClient) || hasInplaceHook(codexHooksPath(env), port)) return undefined;
  const setup = `npx -y github:jonasjancarik/inplace setup codex${port === 8765 ? "" : ` --port ${port}`}`;
  return "Codex: comments the user leaves while you're busy reach you only when you next wait. " +
    `In your reply, offer once to set up a hook that passes them on after each of your tool calls. If the user agrees, run \`${setup}\`, ` +
    "and tell them Codex will ask them to approve the new hook.";
}

function readHooks(path: string): HooksFile | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}
