import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildInfo {
  version: string;
  /** Only when running from a git checkout. */
  branch?: string;
  commit?: string;
  dirty?: boolean;
}

/** Which inplace is running: its package version and, from a checkout, the branch and commit. */
export function readBuildInfo(): BuildInfo {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  let version = "unknown";
  try { version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version; } catch {}
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
  try {
    // An installed copy sits inside someone else's repository; only report the checkout's own.
    if (realpathSync(git("rev-parse", "--show-toplevel")) !== realpathSync(root)) return { version };
    const commit = git("rev-parse", "--short", "HEAD");
    const branch = git("rev-parse", "--abbrev-ref", "HEAD");
    return { version, commit, branch: branch === "HEAD" ? undefined : branch, dirty: git("status", "--porcelain", "--", "src").length > 0 };
  } catch {
    return { version };
  }
}
