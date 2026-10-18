// Tell the agent when the user has paused, so it can react to a burst of edits
// once instead of to every autosave.

import { spawn } from "node:child_process";

/** `"16:34:18 edited p-1: …"` → `"edited p-1"`. */
const label = (line: string) => line.split(" ").slice(1, 3).join(" ").replace(/[:,]$/, "");

/**
 * Collects the change lines the page produces and, once no new one has arrived
 * for `delayMs`, calls `onPause` with them and a one-line summary such as
 * `16:35:30 paused after 3 changes: edited p-1, added tr-3`.
 */
export class PauseWatcher {
  private lines: string[] = [];
  private timer: NodeJS.Timeout | undefined;

  /** `describe` can add to a label in the summary, such as a comment's tag. */
  constructor(
    readonly delayMs: number,
    readonly onPause: (summary: string, lines: string[]) => void,
    readonly describe: (label: string) => string = (label) => label,
  ) {}

  record(line: string): void {
    this.lines.push(line);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Drop the changes still waiting for a pause. */
  cancel(): void {
    clearTimeout(this.timer);
    this.lines = [];
  }

  private flush(): void {
    const lines = this.lines;
    this.lines = [];
    const labels = [...new Set(lines.map(label))].map(this.describe);
    const count = `${lines.length} change${lines.length === 1 ? "" : "s"}`;
    this.onPause(`${new Date().toTimeString().slice(0, 8)} paused after ${count}: ${labels.join(", ")}`, lines);
  }
}

/**
 * Runs a shell command each time the user pauses, with that pause's change
 * lines on stdin. Never two at once: pauses that come in while the command is
 * running are combined into one more run after it finishes.
 */
export class PauseCommand {
  private running = false;
  private waiting: string[] = [];

  constructor(
    readonly command: string,
    readonly env: Record<string, string>,
    readonly log: (line: string) => void,
    readonly onRunning: (running: boolean) => void = () => {},
  ) {}

  run(lines: string[]): void {
    this.waiting.push(...lines);
    if (this.running) return;
    const input = this.waiting.join("\n") + "\n";
    this.waiting = [];
    this.running = true;
    this.onRunning(true);
    const child = spawn(this.command, { shell: true, env: { ...process.env, ...this.env }, stdio: ["pipe", "pipe", "pipe"] });
    const forward = (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) if (line.trim()) this.log(`  on-pause: ${line}`);
    };
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.stdin.on("error", () => {}); // the command may exit without reading its input
    child.stdin.end(input);
    child.on("error", (e) => this.done(`  on-pause: couldn't run the command: ${e.message}`));
    child.on("close", (code) => this.done(code ? `  on-pause: the command exited with code ${code}` : undefined));
  }

  private done(message?: string): void {
    if (!this.running) return; // "error" and "close" can both fire
    this.running = false;
    if (message) this.log(message);
    if (this.waiting.length) this.run([]);
    else this.onRunning(false);
  }
}
