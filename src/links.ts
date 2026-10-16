// Which link addresses the page may add to the document.
//
// Anyone who can open the page can type into it, and the document may be
// published or sent on later, so a link added on the page must not run code
// (`javascript:`) or carry a page of its own (`data:`).

import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["node"];

export const LINK_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);
export const LINK_MESSAGE = "Links can start with http, https, mailto or tel";

/** Thrown when an edit from the page adds a link with another scheme. */
export class UnsafeLink extends Error {
  constructor(readonly href: string) {
    super(LINK_MESSAGE);
  }
}

/**
 * True for relative addresses and http, https, mailto and tel links. Browsers
 * ignore control characters and spaces around an address, and tabs and line
 * breaks inside it, so `" java\tscript:"` is a `javascript:` link too.
 */
export function isSafeHref(href: string): boolean {
  const cleaned = href.replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
  try {
    return LINK_SCHEMES.has(new URL(cleaned, "https://relative.invalid").protocol);
  } catch {
    return false;
  }
}

/** Every `href` in an HTML fragment, decoded as the browser reads it. */
export function hrefsIn(html: string): string[] {
  const found: string[] = [];
  const walk = (node: Node) => {
    if ("attrs" in node) for (const a of node.attrs) if (a.name === "href") found.push(a.value);
    if ("content" in node) walk(node.content as Node);
    if ("childNodes" in node) for (const child of node.childNodes) walk(child);
  };
  if (/href/i.test(html)) walk(parseFragment(html));
  return found;
}

/**
 * Refuse `after` if it adds a link with another scheme. Links already in
 * `before` are left alone, so documents that have them can still be edited.
 */
export function checkNewLinks(before: string, after: string): void {
  const known = new Set(hrefsIn(before));
  for (const href of hrefsIn(after)) if (!known.has(href) && !isSafeHref(href)) throw new UnsafeLink(href);
}
