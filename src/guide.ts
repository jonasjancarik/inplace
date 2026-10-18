import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The agent guide ships at the package root, two levels up from dist/src. */
export const AGENT_GUIDE_PATH = resolve(import.meta.dirname, "..", "..", "agent-guide.md");

/** Parts of the guide few sessions need: left out of the guide an agent gets up front, and read when they're needed. */
const ON_REQUEST: Record<string, string> = {
  "sharing-on-the-network": "opening the document on another device, or with other people on the same network",
  "troubleshooting": "a page that doesn't reload, a block that isn't editable, an edit the user says disappeared",
};

interface GuideSection {
  topic: string;
  text: string;
}

/** A heading as a topic name: "Reacting while you're idle" is reacting-while-youre-idle. */
const topicOf = (heading: string) => heading.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The guide's introduction (topic ""), then one section per ## heading. */
function sections(guide: string): GuideSection[] {
  return guide.split(/^(?=## )/m).map((text) => ({ topic: text.startsWith("## ") ? topicOf(text.slice(3, text.indexOf("\n"))) : "", text }));
}

/** The guide's topics, in order. */
export function guideTopics(): string[] {
  return sections(readFileSync(AGENT_GUIDE_PATH, "utf8")).map((s) => s.topic).filter(Boolean);
}

/**
 * The agent guide. With no topic, all of it but the parts few sessions need, and a note on how to read those; with
 * "all", all of it; with a topic, that part only. Throws for a topic the guide doesn't have, naming the ones it has.
 */
export function agentGuide(topic?: string): string {
  const guide = readFileSync(AGENT_GUIDE_PATH, "utf8");
  if (topic === "all") return guide;
  const parts = sections(guide);
  if (topic) {
    const part = parts.find((s) => s.topic && s.topic === topicOf(topic));
    if (!part) throw new Error(`The guide has no part called ${JSON.stringify(topic)}. Its parts are: ${guideTopics().join(", ")}, or all of it with "all".`);
    return part.text;
  }
  const more = Object.entries(ON_REQUEST).map(([name, about]) => `- ${name}: ${about}`).join("\n");
  return parts.filter((s) => !(s.topic in ON_REQUEST)).map((s) => s.text).join("").trimEnd() + "\n\n## More when you need it\n\n" +
    "These parts of the guide are left out above. Read one when it comes up with `inplace guide <topic>` (MCP: the guide " +
    "tool), and read any other part the same way when you need it again, such as after a long conversation:\n\n" + more + "\n";
}
