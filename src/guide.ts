import { resolve } from "node:path";

/** The agent guide ships at the package root, two levels up from dist/src. */
export const AGENT_GUIDE_PATH = resolve(import.meta.dirname, "..", "..", "agent-guide.md");
