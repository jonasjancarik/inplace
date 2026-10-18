import { execFile, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";

import { block, caretAfter, CLI, type Doc, expect, hoverBlock, idOf, selectText, sourceOf, startDoc, test } from "./fixtures.ts";

const MOD = "ControlOrMeta";

test.describe("opening a document", () => {
  test("text blocks are editable, containers and charts are not", async ({ editor }) => {
    await expect(block(editor, "p", "The roof is already used")).toHaveAttribute("contenteditable", "true");
    await expect(block(editor, "td", "Raised beds")).toHaveAttribute("contenteditable", "true");
    await expect(editor.locator("table")).toHaveAttribute("data-id", /^table-/);
    await expect(editor.locator("table")).not.toHaveAttribute("contenteditable", "true");
    await expect(editor.locator("svg[data-id]")).not.toHaveAttribute("contenteditable", "true");
    expect(await editor.locator("svg text[contenteditable]").count()).toBe(0);
  });

  test("ids are written to the file and nothing else changes", async ({ editor, doc }) => {
    const original = (await import("node:fs")).readFileSync((await import("./fixtures.ts")).EXAMPLE, "utf8");
    await expect(editor.locator("h1")).toHaveAttribute("data-id", "h1-1");
    expect(doc.read().replace(/ data-id="[^"]+"/g, "")).toBe(original);
  });
});

test.describe("typing", () => {
  test("saves only the block that was edited", async ({ editor, doc }) => {
    const before = doc.read();
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await caretAfter(p, "drying laundry");
    await editor.keyboard.type(" and bikes");
    await expect.poll(() => sourceOf(doc, id)).toContain("drying laundry and bikes");
    expect(doc.read()).toBe(before.replace("drying laundry", "drying laundry and bikes"));
    await expect(editor.locator("#inplace-status")).toHaveText("Saved");
  });

  // Typing and then leaving the page at once, before the save timer runs.
  for (const [how, leave] of [
    ["closing the tab", (page: Page) => page.close({ runBeforeUnload: true })],
    ["reloading", (page: Page) => page.reload()],
    ["going to another page", (page: Page) => page.goto("about:blank")],
  ] as const) {
    test(`text typed just before ${how} is saved`, async ({ editor, doc }) => {
      const p = block(editor, "p", "The roof is already used");
      const id = await idOf(p);
      await caretAfter(p, "drying laundry");
      await editor.keyboard.type(" and bikes", { delay: 0 });
      await leave(editor);
      await expect.poll(() => sourceOf(doc, id)).toContain("drying laundry and bikes");
    });
  }

  test("Enter in a table cell leaves it instead of adding a line", async ({ editor, doc }) => {
    const cell = block(editor, "td", "Raised beds");
    await caretAfter(cell);
    await editor.keyboard.press("Enter");
    await expect(cell).not.toBeFocused();
    expect(doc.read()).not.toContain("Raised beds<br>");
  });

  test("pasted text arrives without formatting", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await caretAfter(p, "drying laundry");
    await p.evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/html", "<b style='color:red'>loud</b>");
      data.setData("text/plain", " (quiet\ntext)");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await p.blur();
    await expect.poll(() => sourceOf(doc, id)).toContain("drying laundry (quiet text)");
    expect(sourceOf(doc, id)).not.toMatch(/<b|style=/);
  });
});

test.describe("typing with an input method", () => {
  // Playwright can't drive a real input method, so these send the events one
  // would: Enter while a word is being composed, flagged either way browsers do.
  const composeEnter = (el: Locator) => el.evaluate((node) => {
    node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
    node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "日本" }));
    // Safari sends the confirming Enter after compositionend, with keyCode 229.
    const late = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(late, "keyCode", { value: 229 });
    node.dispatchEvent(late);
  });
  const plainEnter = (el: Locator) => el.evaluate((node) =>
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));

  test("Enter that confirms a word doesn't split the paragraph", async ({ editor }) => {
    const inserts: string[] = [];
    editor.on("request", (r) => { if (r.url().endsWith("/__inplace/insert")) inserts.push(r.url()); });
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await caretAfter(p, "stands empty.");
    await composeEnter(p);
    await editor.waitForTimeout(300);
    expect(inserts).toEqual([]);
    await expect(editor.locator(`[data-id="${id}"]`)).toContainText("A structural survey");
    // An ordinary Enter still splits it.
    await plainEnter(p);
    await expect(editor.locator(`[data-id="${id}"] + p`)).toHaveText(/^\s*A structural survey/);
    expect(inserts).toHaveLength(1);
  });

  test("Enter that confirms a word stays in the table cell", async ({ editor }) => {
    const cell = block(editor, "td", "Raised beds");
    await caretAfter(cell);
    await composeEnter(cell);
    await expect(cell).toBeFocused();
    await plainEnter(cell);
    await expect(cell).not.toBeFocused();
  });

  test("Enter that confirms a word doesn't apply the link", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await selectText(p, "structural survey");
    await editor.keyboard.press(`${MOD}+k`);
    const input = editor.getByLabel("Link address");
    await input.fill("example.com/survey");
    await composeEnter(input);
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await input.press("Enter");
    await expect.poll(() => sourceOf(doc, id)).toContain('<a href="https://example.com/survey">structural survey</a>');
  });

  test("Markdown marks typed through an input method stay as typed", async ({ editor }) => {
    const p = block(editor, "p", "The roof is already used");
    // The text changes as an input method would change it, then the page gets
    // the input event that comes with it.
    const typed = (inputType: string) => p.evaluate((node, inputType) => {
      const text = [...node.childNodes].find((n): n is Text => n.nodeType === 3 && n.data.includes("drying laundry"))!;
      const at = text.data.indexOf("drying laundry") + "drying laundry".length;
      text.insertData(at, " **word**");
      const range = document.createRange();
      range.setStart(text, at + " **word**".length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      node.dispatchEvent(new InputEvent("input", { inputType, data: "*", bubbles: true }));
    }, inputType);
    await caretAfter(p, "drying laundry");
    await typed("insertCompositionText");
    await expect(p.locator("strong")).toHaveCount(0);
    await expect(p).toContainText("drying laundry **word**");
    // The same text typed directly becomes bold.
    await typed("insertText");
    await expect(p.locator("strong")).toHaveText("word");
  });
});

test.describe("formatting", () => {
  test("the toolbar bolds the selected word", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await selectText(p, "laundry");
    const toolbar = editor.locator("#inplace-toolbar");
    await expect(toolbar).toBeVisible();
    await toolbar.getByTitle(/^Bold/).click();
    await expect.poll(() => sourceOf(doc, id)).toContain("drying <strong>laundry</strong>");
  });

  test("keyboard shortcuts toggle formatting on and off", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await selectText(p, "laundry");
    await editor.keyboard.press(`${MOD}+i`);
    await expect.poll(() => sourceOf(doc, id)).toContain("<em>laundry</em>");
    await selectText(p, "laundry");
    await editor.keyboard.press(`${MOD}+i`);
    await expect.poll(() => sourceOf(doc, id)).not.toContain("<em>");
  });

  test("Markdown typed inline becomes formatting", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await caretAfter(p, "drying laundry");
    await editor.keyboard.type(" **really** and `code` x");
    await expect.poll(() => sourceOf(doc, id)).toContain("drying laundry <strong>really</strong> and <code>code</code> x");
    expect(sourceOf(doc, id)).not.toContain("&nbsp;");
  });

  test("a link gets an address and https:// is added", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await selectText(p, "structural survey");
    await editor.keyboard.press(`${MOD}+k`);
    const input = editor.getByLabel("Link address");
    await expect(input).toBeFocused();
    await input.fill("example.com/survey");
    await input.press("Enter");
    await expect.poll(() => sourceOf(doc, id)).toContain('<a href="https://example.com/survey">structural survey</a>');
  });

  test("a javascript: address doesn't become a link", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    const before = sourceOf(doc, id);
    await selectText(p, "structural survey");
    await editor.keyboard.press(`${MOD}+k`);
    const input = editor.getByLabel("Link address");
    await input.fill("javascript:alert(1)");
    await input.press("Enter");
    await expect(editor.locator("#inplace-status")).toHaveText("Links can start with http, https, mailto or tel");
    await expect(p.locator("a")).toHaveCount(0);
    await p.blur();
    await editor.waitForTimeout(800);
    expect(sourceOf(doc, id)).toBe(before);
  });

  test("typing ## and a space turns a paragraph into a heading, keeping its id", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await caretAfter(p, "");
    await p.evaluate((el) => {
      const range = document.createRange();
      range.setStart(el.firstChild!, 0);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    await editor.keyboard.type("## ");
    await expect.poll(() => doc.read()).toMatch(new RegExp(`<h2 data-id="${id}">The roof is already used`));
    await expect(editor.locator(`h2[data-id="${id}"]`)).toBeVisible();
  });
});

test.describe("adding and removing", () => {
  test("Enter in the middle of a paragraph splits it in two", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await caretAfter(p, "stands empty.");
    await editor.keyboard.press("Enter");
    await expect(editor.locator("#inplace-status")).toHaveText("Added");
    const next = editor.locator(`[data-id="${id}"] + p`);
    await expect(next).toBeFocused();
    await expect(next).toHaveText(/^\s*A structural survey/);
    const newId = await idOf(next);
    expect(newId).not.toBe(id);
    await expect.poll(() => sourceOf(doc, id)).toMatch(/stands empty\.<\/p>$/);
    expect(sourceOf(doc, newId)).toMatch(/^<p data-id="p-\d+">A structural survey/);
    expect(doc.output).toMatch(new RegExp(`added ${newId}`));
  });

  test("the + button adds an empty row with the usual cells, and Backspace removes it", async ({ editor, doc }) => {
    const row = editor.locator("tr").filter({ hasText: "Soil and compost" });
    const rowId = await idOf(row);
    const rows = await editor.locator("tbody tr").count();
    await hoverBlock(editor, row);
    await editor.getByRole("button", { name: "Add a row below" }).click();
    await expect(editor.locator("tbody tr")).toHaveCount(rows + 1);
    const added = editor.locator(`tr[data-id="${rowId}"] + tr`);
    await expect(added).toHaveText(/^\s*$/);
    await expect(added.locator("td")).toHaveCount(3);
    const addedId = await idOf(added);
    await expect.poll(() => sourceOf(doc, addedId)).toMatch(/<tr data-id="tr-\d+"><td data-id="td-\d+"><\/td>/);
    // The new first cell has the caret; Backspace in an empty row removes it.
    await expect(added.locator("td").first()).toBeFocused();
    await editor.keyboard.press("Backspace");
    await expect(editor.locator(`[data-id="${addedId}"]`)).toHaveCount(0);
    await expect.poll(() => doc.read()).not.toContain(`data-id="${addedId}"`);
    expect(doc.output).toContain(`removed ${addedId}`);
  });

  test("Backspace doesn't remove a paragraph that still has text", async ({ editor, doc }) => {
    const id = await idOf(block(editor, "li", "Two beds stay open"));
    const li = editor.locator(`[data-id="${id}"]`);
    await caretAfter(li, "");
    await li.evaluate((el) => {
      const range = document.createRange();
      range.setStart(el.firstChild!, 0);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    await editor.keyboard.press("Backspace");
    await editor.waitForTimeout(800);
    expect(doc.read()).toContain(`data-id="${id}"`);
  });

  test("an emptied list item is removed with one more Backspace, even straight away", async ({ editor, doc }) => {
    const id = await idOf(block(editor, "li", "Two beds stay open"));
    const li = editor.locator(`[data-id="${id}"]`);
    await li.evaluate((el) => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    await editor.keyboard.press("Delete");
    await editor.keyboard.press("Backspace");
    await expect(editor.locator(`[data-id="${id}"]`)).toHaveCount(0);
    await expect.poll(() => doc.read()).not.toContain(`data-id="${id}"`);
  });
});

test.describe("moving", () => {
  test("dragging a list item's handle reorders the list in the file", async ({ editor, doc }) => {
    const items = editor.locator("ul > li");
    const first = items.nth(0);
    const third = items.nth(2);
    const firstId = await idOf(first);
    const thirdId = await idOf(third);
    await hoverBlock(editor, first);
    const grip = editor.getByRole("button", { name: "Drag to move this list item" });
    await expect(grip).toBeVisible();
    const g = (await grip.boundingBox())!;
    const t = (await third.boundingBox())!;
    await editor.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await editor.mouse.down();
    await editor.mouse.move(t.x + 40, t.y + t.height - 3, { steps: 8 });
    await editor.mouse.up();
    await expect(editor.locator("#inplace-status")).toContainText("Moved.");
    const html = doc.read();
    expect(html.indexOf(`data-id="${thirdId}"`)).toBeLessThan(html.indexOf(`data-id="${firstId}"`));
    expect(doc.output).toContain(`moved ${firstId} after ${thirdId}`);
  });
});

/** Drag the first item of the first list below the third, as the user would. */
async function dragFirstItemDown(page: Page): Promise<void> {
  const items = page.locator("ul > li");
  await hoverBlock(page, items.nth(0));
  const grip = page.getByRole("button", { name: "Drag to move this list item" });
  const g = (await grip.boundingBox())!;
  const t = (await items.nth(2).boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + 40, t.y + t.height - 3, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#inplace-status")).toContainText("Moved.");
}

test.describe("undoing", () => {
  test("Undo in the message after a move puts the file back as it was", async ({ editor, doc }) => {
    const original = doc.read();
    const first = await idOf(editor.locator("ul > li").first());
    await dragFirstItemDown(editor);
    await expect.poll(() => doc.read()).not.toBe(original);
    await editor.locator("#inplace-status").getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => doc.read()).toBe(original);
    await expect(editor.locator("ul > li").first()).toHaveAttribute("data-id", first);
    expect(doc.output).toMatch(new RegExp(`moved ${first} before \\S+ .*\\(undone\\)`));
  });

  test("Cmd/Ctrl+Z right after a move undoes it", async ({ editor, doc }) => {
    const original = doc.read();
    await dragFirstItemDown(editor);
    await expect.poll(() => doc.read()).not.toBe(original);
    await editor.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => doc.read()).toBe(original);
  });

  test("Cmd/Ctrl+Z after typing undoes only the typing", async ({ editor, doc }) => {
    await dragFirstItemDown(editor);
    const moved = doc.read();
    const item = block(editor, "li", "Two beds stay open");
    await caretAfter(item, "Two beds stay open");
    await editor.keyboard.type("!");
    await expect.poll(() => doc.read()).toContain("Two beds stay open!");
    await editor.keyboard.press("ControlOrMeta+z");
    await expect(item).not.toContainText("open!");
    await editor.locator("h1").click();
    await expect.poll(() => doc.read()).toBe(moved);
  });

  test("your own moves can be undone from the list of changes", async ({ editor, doc }) => {
    const original = doc.read();
    await dragFirstItemDown(editor);
    await expect.poll(() => doc.read()).not.toBe(original);
    await editor.getByRole("button", { name: "Changes" }).click();
    const panel = editor.getByRole("dialog", { name: "Changes" });
    await panel.getByRole("button", { name: "Undo: Moved list item" }).click();
    await expect.poll(() => doc.read()).toBe(original);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Undo/ })).toHaveCount(0);
  });
});

test.describe("showing what changed", () => {
  /** Changes as an agent might make them: two paragraphs, a new row and a removed item. */
  function agentEdits(doc: Doc): void {
    writeFileSync(doc.path, doc.read()
      .replace("last autumn confirmed", "last October confirmed")
      .replace("Two beds stay open", "Three beds stay open")
      .replace(/(<tr[^>]*><td[^>]*>Water<)/, "<tr><td>Tools</td><td>Spades and gloves</td><td>€150</td></tr>\n$1")
      .replace(/<li[^>]*>Volunteers[^<]*<\/li>\n/, ""));
  }
  async function turnOn(page: Page): Promise<void> {
    await page.getByRole("button", { name: "Changes" }).click();
    await page.getByRole("switch", { name: "Show what changed" }).check();
    await expect(page.getByRole("region", { name: "What changed" })).toBeVisible();
  }

  test("a comment added while changes are shown leaves the crossed-out words out", async ({ editor, doc }) => {
    agentEdits(doc);
    await expect(block(editor, "li", "Three beds stay open")).toBeVisible();
    await turnOn(editor);
    const p = block(editor, "p", "October confirmed");

    await selectText(p.locator("del"), "autumn");
    await editor.keyboard.press(`${MOD}+Alt+KeyM`);
    await expect(editor.locator("#inplace-status")).toContainText("Crossed-out text is no longer in the document");
    await expect(editor.getByRole("dialog", { name: "Comment" })).toBeHidden();

    await selectText(p, "confirmed");
    await editor.keyboard.press(`${MOD}+Alt+KeyM`);
    const box = editor.getByRole("dialog", { name: "Comment" });
    await box.getByRole("textbox").fill("Who did the survey?");
    await box.getByRole("textbox").press("Enter");
    await expect.poll(() => doc.output).toContain('at "confirmed": "Who did the survey?"');
    const [comment] = await editor.evaluate(async () => (await (await fetch("/__inplace/comments")).json()).comments);
    expect(comment.prefix).toMatch(/last October $/);
    expect(comment.prefix).not.toContain("autumn");
  });

  test("the page shows the agent's changes in place, read-only, and leaving restores it", async ({ editor, doc }) => {
    agentEdits(doc);
    await expect(block(editor, "li", "Three beds stay open")).toBeVisible();
    const written = doc.read();
    await turnOn(editor);

    const p = block(editor, "p", "October confirmed");
    await expect(p.locator("del")).toHaveText(["autumn"]);
    await expect(p.locator("ins")).toHaveText(["October"]);
    const item = block(editor, "li", "Three beds stay open");
    await expect(item.locator("del")).toHaveText(["Two"]);
    await expect(item.locator("ins")).toHaveText(["Three"]);
    await expect(block(editor, "tr", "Tools")).toHaveClass(/inplace-review-new/);
    const ghost = editor.locator("ul > .inplace-ghost");
    await expect(ghost).toHaveText(/^Volunteers take turns watering/);
    // The ghost stands where the item was: after the one before it.
    await expect(editor.locator("ul > *").nth(2)).toHaveClass(/inplace-ghost/);

    // Typing does nothing.
    await p.click();
    await editor.keyboard.type("xyz");
    await expect(p).not.toContainText("xyz");

    await editor.getByRole("region", { name: "What changed" }).getByRole("button", { name: "Done" }).click();
    await expect(editor.getByRole("region", { name: "What changed" })).toBeHidden();
    await expect(editor.locator("ins, del, .inplace-ghost")).toHaveCount(0);
    await expect(block(editor, "p", "October confirmed")).toHaveAttribute("contenteditable", "true");
    await editor.waitForTimeout(800);
    expect(doc.read()).toBe(written);
  });

  test("it stays on when the agent changes the file again, and marks the new change too", async ({ editor, doc }) => {
    agentEdits(doc);
    await expect(block(editor, "li", "Three beds stay open")).toBeVisible();
    await turnOn(editor);
    doc.edit("first season", "first two seasons");
    await expect(block(editor, "td", "roof mix").locator("ins")).toHaveText("two seasons");
    await expect(editor.getByRole("region", { name: "What changed" })).toBeVisible();
    await expect(block(editor, "p", "October confirmed").locator("del")).toHaveText(["autumn"]);
    // Escape closes the list of changes first, then leaves.
    await editor.keyboard.press("Escape");
    await expect(editor.getByRole("dialog", { name: "Changes" })).toBeHidden();
    await expect(editor.getByRole("region", { name: "What changed" })).toBeVisible();
    await editor.keyboard.press("Escape");
    await expect(editor.getByRole("region", { name: "What changed" })).toBeHidden();
    await expect(editor.locator("ins, del")).toHaveCount(0);
  });

  test("your own edits are left out unless you ask for them", async ({ editor, doc }) => {
    const mine = block(editor, "p", "The roof is already used");
    await caretAfter(mine, "drying laundry");
    await editor.keyboard.type(" daily");
    await expect.poll(() => doc.read()).toContain("drying laundry daily");
    agentEdits(doc);
    await expect(block(editor, "li", "Three beds stay open")).toBeVisible();
    await turnOn(editor);
    await expect(mine.locator("ins")).toHaveText(["October"]);

    const bar = editor.getByRole("region", { name: "What changed" });
    await bar.getByRole("checkbox", { name: "Only the agent’s changes" }).uncheck();
    await expect(mine.locator("ins")).toHaveText(["daily", "October"]);
    await expect(bar.getByRole("checkbox", { name: "Only the agent’s changes" })).not.toBeChecked();
  });
});

/**
 * The text the page currently marks as changed words, in document order. While the page is
 * reloading after the agent's write there's nothing to read yet, so that counts as none.
 */
const highlighted = (page: Page) => page.evaluate(() =>
  [...CSS.highlights.values()].flatMap((h) => [...h]).map((r) => r.toString()))
  .catch((error: Error) => {
    if (/context was destroyed|navigat/i.test(error.message)) return [];
    throw error;
  });

/** Move the mouse onto the first occurrence of a word on the page. */
async function hoverWord(page: Page, word: string): Promise<void> {
  const box = await page.evaluate(async (word) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
      const i = t.data.indexOf(word);
      if (i === -1) continue;
      t.parentElement!.scrollIntoView({ block: "center" });
      // Let the scroll settle, since scrolling hides the tooltip.
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const range = document.createRange();
      range.setStart(t, i);
      range.setEnd(t, i + word.length);
      const r = range.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    throw new Error(`hoverWord: "${word}" not found`);
  }, word);
  await page.mouse.move(box.x - 1, box.y);
  await page.mouse.move(box.x, box.y);
}

test.describe("showing who wrote what", () => {
  test("a bar beside each changed block says who changed it, once the switch is on", async ({ editor, doc }) => {
    writeFileSync(doc.path, doc.read().replace("last autumn confirmed", "last October confirmed"));
    await expect(block(editor, "p", "October confirmed")).toBeVisible();
    await editor.getByRole("button", { name: "Changes" }).click();
    const bars = editor.locator("#inplace-authors-layer .bar");
    await expect(bars).toHaveCount(0);
    await editor.getByRole("switch", { name: "Show who wrote what" }).check();
    // While the change is still to review, its own bar takes the place of this one.
    await expect(editor.locator("#inplace-pending-layer .bar")).toHaveCount(1);
    await expect(bars).toHaveCount(0);
    await editor.getByRole("button", { name: "Keep: Edited paragraph" }).click();
    await expect(editor.locator("#inplace-pending-layer .bar")).toHaveCount(0);
    await expect(bars).toHaveCount(1);
    await expect(bars.first()).toHaveAttribute("title", /^Your agent changed this /);
    // The choice is remembered for this document.
    await editor.reload();
    await editor.getByRole("button", { name: "Changes" }).click();
    await expect(editor.getByRole("switch", { name: "Show who wrote what" })).toBeChecked();
    await expect(bars).toHaveCount(1);
    await editor.emulateMedia({ media: "print" });
    await expect(editor.locator("#inplace-authors-layer")).toBeHidden();
  });
});

test.describe("reviewing the agent's changes", () => {
  test("undo one rewrite and an added paragraph, keep the other rewrite, and the file follows", async ({ editor, doc }) => {
    const original = doc.read();
    // One write that rewrites two paragraphs and adds one, as an agent's edit might.
    writeFileSync(doc.path, original
      .replace("last autumn confirmed", "last October confirmed")
      .replace("raising monthly contributions", "raising the monthly contributions")
      .replace(/(<p data-id="p-\d+">The association)/, "<p>The beds arrive in April.</p>\n$1"));
    const bars = editor.locator("#inplace-pending-layer .bar");
    await expect(bars).toHaveCount(3);

    // Pointing at a changed paragraph offers Keep and Undo beside it.
    const survey = block(editor, "p", "The roof is already used");
    await survey.hover();
    const actions = editor.locator("#inplace-pending-actions");
    await expect(actions).toBeVisible();
    await actions.getByRole("button", { name: "Undo your agent's change to this paragraph" }).click();
    await expect(survey).toContainText("last autumn confirmed");
    await expect(bars).toHaveCount(2);
    // The undone change is the user's, so it isn't highlighted as the agent's.
    await expect(survey).not.toHaveClass(/inplace-changed/);

    // The list of changes has the rest, with the new paragraph.
    await editor.getByRole("button", { name: "Changes" }).click();
    const review = editor.locator("#inplace-changes .to-review");
    await expect(review.getByRole("heading")).toHaveText("Your agent’s changes to review (2)");
    await review.getByRole("button", { name: "Undo: New paragraph" }).click();
    await expect(block(editor, "p", "The beds arrive in April")).toHaveCount(0);
    await expect(bars).toHaveCount(1);
    // Never printed.
    await editor.emulateMedia({ media: "print" });
    await expect(bars.first()).toBeHidden();
    await editor.emulateMedia({ media: "screen" });
    await expect(bars.first()).toBeVisible();

    await editor.getByRole("button", { name: "Changes" }).click(); // closes the list
    await block(editor, "p", "The association").hover();
    await actions.getByRole("button", { name: "Keep your agent's change to this paragraph" }).click();
    await expect(bars).toHaveCount(0);
    await expect(actions).toBeHidden();

    expect(doc.read()).toBe(original.replace("raising monthly contributions", "raising the monthly contributions"));
    await expect.poll(() => doc.output).toMatch(/undid the agent's change to p-\d+: .*October.* → .*autumn/);
    await expect.poll(() => doc.output).toMatch(/undid the agent's addition of p-\d+, so it's gone again: "The beds arrive in April\."/);
  });
});

test.describe("working alongside an agent", () => {
  test("an edit to the file on disk reloads the page", async ({ editor, doc }) => {
    doc.edit("Two beds stay open", "Three beds stay open");
    await expect(block(editor, "li", "Three beds stay open")).toBeVisible();
  });

  test("the agent's changes are highlighted, and Show scrolls to the ones out of view", async ({ editor, doc }) => {
    await editor.setViewportSize({ width: 900, height: 360 });
    const h1 = editor.locator("h1");
    const mine = block(editor, "p", "The roof is already used");
    await caretAfter(mine, "drying laundry");
    await editor.keyboard.type(" daily");
    await expect.poll(() => doc.read()).toContain("drying laundry daily");
    // One write that changes three places, as an agent's edit might.
    writeFileSync(doc.path, doc.read()
      .replace(/A garden on the roof(?=<)/, "A garden on the roof of building B")
      .replace("Two beds stay open", "Three beds stay open")
      .replace(/(<tr[^>]*><td[^>]*>Water<)/, "<tr><td>Tools</td><td>Spades and gloves</td><td>€150</td></tr>\n$1"));

    await expect(h1).toHaveText("A garden on the roof of building B");
    const pill = editor.locator("#inplace-status");
    await expect(pill).toContainText("Your agent made 3 changes. 2 are out of view.");
    // In a paragraph only the changed words are tinted; a new row is tinted whole.
    await expect.poll(() => highlighted(editor)).toEqual(["of building B", "Three"]);
    await expect(h1).not.toHaveClass(/inplace-changed/);
    await expect(block(editor, "li", "Three beds stay open")).toHaveClass(/inplace-changed-words/);
    await expect(block(editor, "tr", "Tools")).toHaveClass(/inplace-changed\b/);
    await expect(editor.locator("table")).not.toHaveClass(/inplace-changed/);
    await expect(editor.locator(".inplace-changed, .inplace-changed-fade")).toHaveCount(1);
    await expect(mine).not.toHaveClass(/inplace-changed/);

    await pill.getByRole("button", { name: "Show" }).click();
    await expect(block(editor, "tr", "Tools")).toBeInViewport();
    await expect(pill).toContainText("One is out of view.");
    await pill.getByRole("button", { name: "Show" }).click();
    await expect(pill).toHaveText("Your agent made 3 changes.");
    // Once seen, the tint fades away.
    await expect(editor.locator(".inplace-changed, .inplace-changed-fade")).toHaveCount(0, { timeout: 8_000 });
    await expect.poll(() => highlighted(editor), { timeout: 8_000 }).toEqual([]);
  });

  test("the corner button lists your changes and the agent's, and stays open while the agent works", async ({ editor, doc }) => {
    const corner = editor.locator("#inplace-corner");
    await expect(corner).toBeVisible();
    const mine = block(editor, "p", "The roof is already used");
    await caretAfter(mine, "drying laundry");
    await editor.keyboard.type(" daily");
    await expect.poll(() => doc.read()).toContain("drying laundry daily");
    await expect(corner).toBeVisible();
    await expect(corner.locator(".dot")).toHaveCount(0);

    writeFileSync(doc.path, doc.read()
      .replace(/A garden on the roof(?=<)/, "A garden on the roof of building B")
      .replace("Two beds stay open for herbs", "Three beds stay open for herbs and flowers"));
    await expect(editor.locator("h1")).toHaveText("A garden on the roof of building B");
    await expect(corner.locator(".dot")).toHaveCount(1);
    await editor.getByRole("button", { name: "Changes" }).click();
    const panel = editor.getByRole("dialog", { name: "Changes" });
    await expect(corner.locator(".dot")).toHaveCount(0);

    const entries = panel.locator(".entry");
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toContainText("Your agent");
    await expect(entries.nth(0)).toContainText("Edited heading");
    const heading = entries.nth(0).locator(".change").filter({ hasText: "Edited heading" });
    await expect(heading.locator("ins")).toHaveText("of building B");
    // Only the changed words are marked, each where it changed.
    const item = entries.nth(0).locator(".change").filter({ hasText: "Edited list item" });
    await expect(item.locator("del")).toHaveText(["Two"]);
    await expect(item.locator("ins")).toHaveText(["Three", "and flowers"]);
    await expect(item.locator(".text")).toHaveText("Two Three beds stay open for herbs and flowers anyone can pick.");
    await expect(entries.nth(1)).toContainText("You");
    await expect(entries.nth(1).locator("ins")).toHaveText("daily");

    // The agent changes the file again while the list is open.
    doc.edit(/(<tr[^>]*><td[^>]*>Water<)/, "<tr><td>Tools</td><td>Spades and gloves</td><td>€150</td></tr>\n$1");
    await expect(block(editor, "tr", "Tools")).toBeVisible();
    await expect(panel).toBeVisible();
    await expect(entries.nth(0)).toContainText("New table row");
    await expect(entries.nth(0)).toContainText("Edited heading");

    await entries.nth(0).getByRole("button", { name: /New table row/ }).click();
    await expect(block(editor, "tr", "Tools")).toHaveClass(/inplace-changed/);
    // Showing an edited paragraph again lights up only its changed words.
    await item.click();
    await expect.poll(() => highlighted(editor)).toContain("and flowers");
    await editor.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("hovering a word the agent changed shows the word it replaced, and nothing reaches the file", async ({ editor, doc }) => {
    doc.edit("last autumn confirmed", "last October confirmed");
    const p = block(editor, "p", "last October confirmed");
    await expect.poll(() => highlighted(editor)).toEqual(["October"]);
    const written = doc.read();
    const tip = editor.getByRole("tooltip");

    await hoverWord(editor, "October");
    await expect(tip).toHaveText("Was: autumn");
    await expect(tip.locator("del")).toHaveText("autumn");
    await hoverWord(editor, "confirmed");
    await expect(tip).toBeHidden();
    // Clicking the word puts the caret there; leaving the paragraph would save
    // anything that had ended up inside it.
    await hoverWord(editor, "October");
    await editor.mouse.down();
    await editor.mouse.up();
    await expect(tip).toBeVisible();
    await expect(p).toBeFocused();
    await editor.locator("h1").click();
    await editor.waitForTimeout(1000);
    expect(doc.read()).toBe(written);
    expect(doc.output).not.toMatch(/edited/);
  });

  test("each changed stretch shows its own old words", async ({ editor, doc }) => {
    // A replacement and an insertion in one paragraph.
    doc.edit("last autumn confirmed it can carry raised beds", "last October confirmed it can carry wooden raised beds");
    await expect.poll(() => highlighted(editor)).toEqual(["October", "wooden"]);
    const tip = editor.getByRole("tooltip");
    await hoverWord(editor, "October");
    await expect(tip).toHaveText("Was: autumn");
    await hoverWord(editor, "wooden");
    await expect(tip).toHaveText("Added by your agent");
  });

  test("hovering works after the tint has faded, and after a reload until the change is kept", async ({ editor, doc }) => {
    doc.edit("last autumn confirmed", "last October confirmed");
    await expect(block(editor, "p", "last October confirmed")).toBeVisible();
    await expect.poll(() => highlighted(editor), { timeout: 8_000 }).toEqual([]);
    const tip = editor.getByRole("tooltip");
    await hoverWord(editor, "October");
    await expect(tip).toHaveText("Was: autumn");

    await editor.mouse.move(1, 1);
    doc.edit("Two beds stay open", "Three beds stay open");
    await expect(block(editor, "li", "Three beds stay open")).toBeVisible();
    await hoverWord(editor, "October");
    await expect(tip).toHaveText("Was: autumn");
    await expect.poll(() => highlighted(editor)).not.toContain("October");
    await editor.getByRole("button", { name: "Keep your agent's change to this paragraph" }).click();
    await editor.mouse.move(1, 1);
    await hoverWord(editor, "October");
    await editor.waitForTimeout(200);
    await expect(tip).toBeHidden();
  });

  test("your caret block survives the reload", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await caretAfter(p);
    doc.edit("A garden on the roof", "A garden on the roof of building B");
    await expect(editor.locator("h1")).toHaveText("A garden on the roof of building B");
    await expect(editor.locator(`[data-id="${id}"]`)).toBeFocused();
  });

  test("your edit and the agent's edit to the same paragraph are combined", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await caretAfter(p, "drying laundry");
    await editor.keyboard.type(" every day");
    // The agent edits the start of the same paragraph before the page has saved.
    doc.edit("The roof is already used", "The flat roof is already used");
    await expect.poll(() => sourceOf(doc, id)).toContain("The flat roof is already used for drying laundry every day");
    await expect(editor.locator(`[data-id="${id}"]`)).toContainText("The flat roof is already used for drying laundry every day");
    expect(doc.output).toContain(`edited ${id}, merged with the file's newer version`);
  });

  test("a clashing edit is set aside and can be put back from the page", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    const old = await p.evaluate((el) => el.innerHTML);
    doc.edit("The roof is already used for drying laundry", "AGENT: The roof is used for laundry");
    // A save from a page that still shows the old text, as in a race with the agent.
    const status = await editor.evaluate(async ({ id, old }) => (await fetch("/__inplace/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, old, new: old.replace("drying laundry", "MINE: hanging washing") }),
    })).status, { id, old });
    expect(status).toBe(409);
    expect(sourceOf(doc, id)).toContain("AGENT: The roof is used for laundry");
    expect(doc.output).toMatch(new RegExp(`conflict on ${id}: .*MINE: hanging washing`));

    await editor.getByRole("button", { name: "1 edit set aside" }).click();
    await editor.getByRole("dialog", { name: "Changes" }).getByRole("button", { name: "Review" }).click();
    const dialog = editor.getByRole("dialog", { name: "Set-aside edits" });
    await expect(dialog).toContainText("MINE: hanging washing");
    await expect(dialog).toContainText("AGENT: The roof is used for laundry");
    await dialog.getByRole("button", { name: "Use my version" }).click();
    await expect.poll(() => sourceOf(doc, id)).toContain("MINE: hanging washing");
    await expect(editor.locator(`[data-id="${id}"]`)).toContainText("MINE: hanging washing");
    await expect(editor.getByRole("button", { name: /set aside/ })).toBeHidden();
  });

  test("the list of changes says what is known about the agent picking up your edits", async ({ editor, doc }) => {
    const mine = block(editor, "p", "The roof is already used");
    await caretAfter(mine, "drying laundry");
    await editor.keyboard.type(" daily");
    await expect.poll(() => doc.read()).toContain("drying laundry daily");
    await editor.getByRole("button", { name: "Changes" }).click();
    const line = editor.getByRole("dialog", { name: "Changes" }).locator(".agent-status");
    // The agent may be reading the terminal output, so nothing is claimed about it.
    await expect(line).toHaveText("If your agent doesn't react to your edits, ask it to check them.");

    // An agent starts `inplace wait`, then goes away.
    const port = Number(new URL(doc.url).port);
    const wait = (await import("node:http")).get({ host: "127.0.0.1", port, path: "/__inplace/wait", headers: { host: `localhost:${port}` } });
    wait.on("error", () => {});
    await expect(line).toHaveText("Your agent is waiting for your next pause.");
    wait.destroy();
    await expect(line).toHaveText("Your agent last checked your changes just now.");
  });

  test("every change is listed in the server output", async ({ editor, doc }) => {
    const p = block(editor, "p", "The roof is already used");
    const id = await idOf(p);
    await caretAfter(p, "drying laundry");
    await editor.keyboard.type("!");
    await expect.poll(() => doc.output).toMatch(new RegExp(`edited ${id}: .*laundry!`));
  });
});

test("unclosed paragraphs and list items can be edited", async ({ page }) => {
  const doc = await startDoc(undefined, "<!doctype html><title>t</title><body><p>One<p>Two\n<ul><li>A<li>B</ul></body>");
  try {
    await page.goto(doc.url);
    const li = block(page, "li", "A");
    await caretAfter(li);
    await page.keyboard.type("lpha");
    await expect.poll(() => doc.read()).toContain(">Alpha<li");
  } finally {
    doc.stop();
  }
});

test("deliberate non-breaking spaces stay when you edit nearby", async ({ page }) => {
  const doc = await startDoc(undefined, "<!doctype html><title>t</title><body><p>Cena <strong>5</strong>&nbsp;Kč, v&nbsp;Praze. Konec</p></body>");
  try {
    await page.goto(doc.url);
    const p = page.locator("p");
    await caretAfter(p, "Konec");
    await page.keyboard.type(" **dne**s");
    await expect.poll(() => doc.read()).toContain("Konec <strong>dne</strong>s</p>");
    expect(doc.read()).toContain("<strong>5</strong>&nbsp;Kč, v&nbsp;Praze.");
  } finally {
    doc.stop();
  }
});

test.describe("pages with unusual styles and parts", () => {
  /** Serve `html`, open it, run `body`, then stop the server. */
  async function withDoc(page: Page, html: string, body: (doc: Awaited<ReturnType<typeof startDoc>>) => Promise<void>) {
    const doc = await startDoc(undefined, html);
    try {
      await page.goto(doc.url);
      await page.waitForFunction(() => document.querySelector("#inplace-toolbar"));
      await body(doc);
    } finally {
      doc.stop();
    }
  }
  const RESET = "<style>a{color:inherit;text-decoration:inherit}</style>";
  const decoration = (el: Locator) => el.evaluate((a) => getComputedStyle(a).textDecorationLine);

  async function addLink(page: Page) {
    const p = page.locator("p").first();
    await selectText(p, "survey");
    await page.keyboard.press(`${MOD}+k`);
    await page.getByLabel("Link address").fill("example.com");
    await page.getByLabel("Link address").press("Enter");
    return p.locator("a");
  }

  test("a new link is underlined while editing when the page's reset hides it", async ({ page }) => {
    await withDoc(page, `<!doctype html><title>t</title>${RESET}<body><p>Read the survey now.</p></body>`, async (doc) => {
      const a = await addLink(page);
      await expect.poll(() => decoration(a)).toBe("underline");
      await expect.poll(() => doc.read()).toContain('<a href="https://example.com">survey</a>');
      expect(doc.read()).not.toMatch(/underline|style=/);
    });
  });

  test("links already on a page with a reset are underlined from the start", async ({ page }) => {
    await withDoc(page, `<!doctype html><title>t</title>${RESET}<body><p>See <a href="/x">this</a>.</p></body>`, async () => {
      await expect.poll(() => decoration(page.locator("a"))).toBe("underline");
    });
  });

  test("links keep the page's own style when it sets them apart", async ({ page }) => {
    const html = "<!doctype html><title>t</title><style>a{color:#c00;text-decoration:none}</style><body><p>Read the survey now.</p></body>";
    await withDoc(page, html, async () => {
      const a = await addLink(page);
      await expect(a).toHaveCount(1);
      expect(await decoration(a)).toBe("none");
      await expect(page.locator("html")).not.toHaveClass(/inplace-plain-links/);
    });
  });

  const PARTS = `<!doctype html><title>t</title><body>
<p>Intro text.</p>
<details><summary>More</summary><p>Folded text here.</p></details>
<div role="tablist"><button role="tab" aria-controls="tab-a">A</button><button role="tab" aria-controls="tab-b">B</button></div>
<div id="tab-a" role="tabpanel"><p>Alpha panel text.</p></div>
<div id="tab-b" role="tabpanel" hidden><p>Beta panel text.</p></div>
<div style="display:none"><p>Hidden for good.</p></div>
<script>for (const b of document.querySelectorAll("[role=tab]")) b.onclick = () => {
  for (const p of document.querySelectorAll("[role=tabpanel]")) p.hidden = p.id !== b.getAttribute("aria-controls");
};</script>
</body>`;

  test("Show opens a closed details and a tab panel to reach the agent's changes", async ({ page }) => {
    await withDoc(page, PARTS, async (doc) => {
      writeFileSync(doc.path, doc.read().replace("Folded text here", "Folded words here").replace("Beta panel text", "Beta panel words"));
      const pill = page.locator("#inplace-status");
      await expect(pill).toContainText("Your agent made 2 changes. 2 are out of view.");
      await pill.getByRole("button", { name: "Show" }).click();
      await expect(block(page, "p", "Folded words here")).toBeVisible();
      await expect(pill).toContainText("One is out of view.");
      await pill.getByRole("button", { name: "Show" }).click();
      await expect(block(page, "p", "Beta panel words")).toBeVisible();
      await expect(block(page, "p", "Alpha panel text")).toBeHidden();
      await expect(pill).toHaveText("Your agent made 2 changes.");
      await expect.poll(() => highlighted(page)).toEqual(expect.arrayContaining(["words"]));
    });
  });

  test("the list of changes opens the tab panel a change is in", async ({ page }) => {
    await withDoc(page, PARTS, async (doc) => {
      doc.edit("Beta panel text", "Beta panel words");
      await expect(page.locator("#inplace-status")).toContainText("One is out of view.");
      await page.getByRole("button", { name: "Changes" }).click();
      await page.getByRole("dialog", { name: "Changes" }).locator(".entry").getByRole("button", { name: /Edited paragraph/ }).click();
      await expect(block(page, "p", "Beta panel words")).toBeVisible();
      await expect.poll(() => highlighted(page)).toContain("words");
    });
  });

  test("a change that can't be shown says so", async ({ page }) => {
    await withDoc(page, PARTS, async (doc) => {
      doc.edit("Hidden for good", "Hidden for ever");
      const pill = page.locator("#inplace-status");
      await expect(pill).toContainText("One is out of view.");
      await pill.getByRole("button", { name: "Show" }).click();
      await expect(pill).toHaveText("This change is in a part of the page that's hidden.");
    });
  });
});

test.describe("blocks changed by the page's scripts", () => {
  const TABLE = `<!doctype html><title>t</title><body><table><tr>
    <td data-id="td-1">Tom &amp; Jerry&nbsp;<a href='x.html' title=a&quot;b>link</a><br/>two</td>
    <td data-id="td-2">0</td></tr></table>`;

  test("a cell a script fills in on load can't be edited; its neighbour can", async ({ page }) => {
    const doc = await startDoc(undefined, TABLE +
      `<script>document.querySelector('[data-id="td-2"]').textContent = "42";</script></body>`);
    try {
      await page.goto(doc.url);
      const total = page.locator('[data-id="td-2"]');
      await expect(total).toHaveText("42");
      await expect(total).not.toHaveAttribute("contenteditable", "true");
      await expect(total).toHaveAttribute("title", /filled in by a script/);
      await expect(page.locator('[data-id="td-1"]')).toHaveAttribute("contenteditable", "true");
      // After an agent's edit elsewhere, the filled-in cell isn't shown as changed.
      doc.edit("two", "three");
      await expect(page.locator('[data-id="td-1"]')).toHaveClass(/inplace-changed/);
      await expect(total).not.toHaveClass(/inplace-changed/);
    } finally {
      doc.stop();
    }
  });

  test("a script that changes a block after load doesn't get its text into the file", async ({ page }) => {
    const doc = await startDoc(undefined, TABLE +
      `<script>setTimeout(() => (document.querySelector('[data-id="td-2"]').textContent = "42"), 300);</script></body>`);
    try {
      await page.goto(doc.url);
      const total = page.locator('[data-id="td-2"]');
      await expect(total).toHaveText("42");
      await expect(total).not.toHaveAttribute("contenteditable", "true");
      const before = doc.read();
      await total.click();
      await page.keyboard.type("1");
      await page.locator('[data-id="td-1"]').click();
      await page.waitForTimeout(800);
      expect(doc.read()).toBe(before);
    } finally {
      doc.stop();
    }
  });

  test("blocks a script leaves alone stay editable and save as usual", async ({ page }) => {
    const doc = await startDoc(undefined, TABLE + `<script>window.ready = true;</script></body>`);
    try {
      await page.goto(doc.url);
      const cell = page.locator('[data-id="td-1"]');
      await expect(cell).toHaveAttribute("contenteditable", "true");
      await caretAfter(cell, "two");
      await page.keyboard.type(" three");
      await expect.poll(() => doc.read()).toContain(">two three</td>");
    } finally {
      doc.stop();
    }
  });
});

test.describe("comments", () => {
  /** The text of each comment highlight on the page. */
  const highlighted = (page: Page) => page.evaluate(() =>
    [...((CSS as any).highlights.get("inplace-comment") ?? [])].map((r: Range) => r.toString()));

  test("select text, add a comment, and it stays on that text through a reload and the agent's edits", async ({ editor, doc }) => {
    const para = block(editor, "p", "The roof is already used");
    const id = await idOf(para);
    await selectText(para, "drying laundry");
    await editor.locator("#inplace-toolbar").getByRole("button", { name: "Comment" }).click();
    const box = editor.getByRole("dialog", { name: "Comment" });
    await box.getByRole("textbox").fill("Which buildings share it?");
    await box.getByRole("textbox").press("Enter");
    await expect(box).toBeHidden();
    await expect.poll(() => highlighted(editor)).toEqual(["drying laundry"]);
    await expect.poll(() => doc.output).toContain(`comment #1 on ${id} at "drying laundry": "Which buildings share it?"`);
    expect(doc.read()).not.toContain("Which buildings");

    await editor.getByRole("button", { name: "Changes" }).click();
    const listed = editor.getByRole("dialog", { name: "Changes" }).locator(".comments .comment");
    await expect(listed).toHaveCount(1);
    await expect(listed).toContainText("drying laundry");
    await expect(listed).toContainText("Which buildings share it?");
    await expect(listed).toContainText("Not done yet");

    await editor.reload();
    await expect.poll(() => highlighted(editor)).toEqual(["drying laundry"]);
    await expect(editor.locator("#inplace-comment-layer .marker")).toHaveCount(1);

    // The agent rewrites the paragraph around the quote: the comment follows it.
    doc.edit("The roof is already used for drying laundry", "Today the roof is only used for drying laundry");
    await expect(block(editor, "p", "Today the roof")).toBeVisible();
    await expect.poll(() => highlighted(editor)).toEqual(["drying laundry"]);

    // Then removes the quoted words: the comment is kept and says the text changed.
    doc.edit("for drying laundry", "for storage");
    await expect(block(editor, "p", "for storage")).toBeVisible();
    await expect.poll(() => highlighted(editor)).toEqual([]);
    await editor.getByRole("button", { name: "Changes" }).click();
    await expect(listed).toContainText("The text this was about has changed");
    await expect(listed).toContainText("drying laundry");

    // The agent marks it done: it's greyed out with the reply, and can be cleared.
    const { execFileSync } = await import("node:child_process");
    execFileSync(process.execPath, [new URL("../dist/src/cli.js", import.meta.url).pathname, "resolve", "1",
      "--reply", "Buildings A and B.", "--port", new URL(doc.url).port]);
    await expect(listed).toContainText("Done");
    await expect(listed).toContainText("Your agent: Buildings A and B.");
    await expect(editor.locator("#inplace-comment-layer .marker")).toHaveCount(0);
    await editor.getByRole("button", { name: "Clear done comments" }).click();
    await expect(listed).toHaveCount(0);
  });

  test("a keyboard selection gets the Comment button too, and the shortcut opens the box", async ({ editor }) => {
    const para = block(editor, "p", "The roof is already used");
    await caretAfter(para, "The roof");
    await editor.keyboard.press("Shift+ArrowLeft");
    await editor.keyboard.press("Shift+ArrowLeft");
    await editor.keyboard.press("Shift+ArrowLeft");
    await editor.keyboard.press("Shift+ArrowLeft");
    await expect(editor.locator("#inplace-toolbar").getByRole("button", { name: "Comment" })).toBeVisible();
    await editor.keyboard.press("Control+Alt+KeyM");
    const box = editor.getByRole("dialog", { name: "Comment" });
    await expect(box).toBeVisible();
    await expect(box.locator(".quote")).toHaveText("roof");
    await box.getByRole("textbox").press("Escape");
    await expect(box).toBeHidden();
  });

  test("a chart gets a Comment button on hover, for a comment on the whole of it", async ({ editor, doc }) => {
    const chart = editor.locator("svg[data-id]").first();
    await chart.scrollIntoViewIfNeeded();
    await chart.hover();
    await editor.locator("#inplace-comment-here").click();
    const box = editor.getByRole("dialog", { name: "Comment" });
    await expect(box).toContainText("Comment on this chart");
    await box.getByRole("textbox").fill("Same order as the table, please.");
    await box.getByRole("button", { name: "Add comment" }).click();
    await expect.poll(() => doc.output).toMatch(/comment #1 on svg-\d+: "Same order as the table, please."/);
    await editor.locator("#inplace-comment-layer .marker").click();
    await expect(box).toContainText("Same order as the table, please.");
    await box.getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => doc.output).toContain("comment #1 deleted");
  });

  test("the agent's question offers its suggested answers, and one click sends one", async ({ editor, doc }) => {
    const port = new URL(doc.url).port;
    const id = await editor.locator("h1[data-id]").getAttribute("data-id");
    execFileSync(process.execPath, [CLI, "comment", id!, "Should the title say garden or orchard?", "--port", port,
      "--option", "Garden", "--option", "Orchard, and change the rest too"]);
    await expect(editor.locator("#inplace-comment-layer .marker.agent")).toHaveCount(1);
    await editor.locator("#inplace-comment-layer .marker").click();
    const box = editor.getByRole("dialog", { name: "Comment" });
    await expect(box.locator(".choices button")).toHaveText(["Garden", "Orchard, and change the rest too", "Write your own"]);
    await box.getByRole("button", { name: "Garden" }).click();
    await expect.poll(() => doc.output).toContain('comment #1 answered by the user: "Garden"');

    // Once answered, the suggestions are gone and the answer can still be changed in words.
    await editor.locator("#inplace-comment-layer .marker").click();
    await expect(box).toContainText("You: Garden");
    await expect(box.locator(".choices")).toHaveCount(0);
    await box.getByRole("button", { name: "Change answer" }).click();
    await box.getByRole("textbox").fill("Garden, but mention the fruit trees");
    await box.getByRole("textbox").press("Enter");
    await expect.poll(() => doc.output).toContain('comment #1 answered by the user: "Garden, but mention the fruit trees"');
  });

  test("Write your own replaces the suggested answers with a text field", async ({ editor, doc }) => {
    const id = await editor.locator("h1[data-id]").getAttribute("data-id");
    execFileSync(process.execPath, [CLI, "comment", id!, "Shorter title?", "--port", new URL(doc.url).port, "--option", "Yes"]);
    await expect(editor.locator("#inplace-comment-layer .marker")).toHaveCount(1);
    await editor.locator("#inplace-comment-layer .marker").click();
    const box = editor.getByRole("dialog", { name: "Comment" });
    await box.getByRole("button", { name: "Write your own" }).click();
    await expect(box.locator(".choices")).toHaveCount(0);
    await box.getByRole("textbox").fill("Keep it, but drop the subtitle");
    await box.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => doc.output).toContain('comment #1 answered by the user: "Keep it, but drop the subtitle"');
  });
});

test("an agent waiting for pauses gets an eye beside the block you edited, then a check that fades", async ({ page }) => {
  const doc = await startDoc(undefined, undefined, ["--pause", "0.4"]);
  const port = new URL(doc.url).port;
  // An agent in the `inplace wait` loop, as Codex runs it.
  const wait = () => new Promise<void>((ok, fail) =>
    execFile(process.execPath, [CLI, "wait", "--port", port], (e) => (e ? fail(e) : ok())));
  try {
    await page.goto(doc.url);
    await page.waitForFunction(() => document.querySelector("#inplace-toolbar"));
    const para = block(page, "p", "The roof is already used");
    const id = await idOf(para);
    const mark = page.locator(`#inplace-seen-layer .seen[data-for="${id}"]`);

    let waiting = wait();
    await caretAfter(para, "drying laundry");
    await page.keyboard.type(" daily");
    await waiting;
    await expect(mark).toHaveAttribute("aria-label", "Your agent picked up this change.");
    expect(await para.locator(".seen").count()).toBe(0);
    expect(doc.read()).not.toContain("inplace-seen");

    // Editing the block again takes the mark away until the agent has that change too.
    await page.keyboard.type(" again");
    await expect(mark).toHaveCount(0);
    waiting = wait();
    await waiting;
    await expect(mark).toHaveAttribute("data-mark", "picked");

    // The agent waits again once it's done: the eye turns into a check, which fades.
    void wait().catch(() => {});
    await expect(mark).toHaveAttribute("aria-label", "Your agent checked this change.");
    await expect(mark).toHaveCount(0, { timeout: 5_000 });
    expect(doc.read()).not.toContain("inplace-seen");
  } finally {
    doc.stop();
  }
});

test.describe("pages that can only be commented on or read", () => {
  const open = async (page: import("@playwright/test").Page, flag: string) => {
    const doc = await startDoc(undefined, undefined, [flag]);
    await page.goto(doc.url);
    await page.waitForFunction(() => document.querySelector("#inplace-toolbar"));
    return doc;
  };

  test("--comment-only: you can comment on selected words, but not type, move or add", async ({ page }) => {
    const doc = await open(page, "--comment-only");
    try {
      const para = block(page, "p", "The roof is already used");
      await expect(page.locator("[contenteditable]")).toHaveCount(0);
      const before = doc.read();
      await para.click();
      await page.keyboard.type("nope");
      await hoverBlock(page, para);
      await expect(page.locator("#inplace-ui button")).toHaveCount(0);
      expect(doc.read()).toBe(before);

      // Selecting words offers Comment and nothing else.
      await selectText(para, "drying laundry");
      const toolbar = page.locator("#inplace-toolbar");
      await expect(toolbar.getByRole("button", { name: "Comment" })).toBeVisible();
      await expect(toolbar.getByRole("button", { name: "Bold" })).toBeHidden();
      await expect(toolbar.locator("[data-format]").first()).toBeHidden();
      await toolbar.getByRole("button", { name: "Comment" }).click();
      const box = page.getByRole("dialog", { name: "Comment" });
      await box.getByRole("textbox").fill("Which buildings share it?");
      await box.getByRole("button", { name: "Add comment" }).click();
      await expect.poll(() => doc.output).toContain(`at "drying laundry": "Which buildings share it?"`);
      await expect(page.locator("#inplace-comment-layer .marker")).toHaveCount(1);

      // The list of changes says what this page allows.
      await page.locator("#inplace-corner").click();
      await expect(page.getByRole("dialog", { name: "Changes" })).toContainText("You can comment on this document, but not edit it.");
      expect(doc.read()).toBe(before);
    } finally {
      doc.stop();
    }
  });

  test("--comment-only: triple-clicking a paragraph offers Comment", async ({ page }) => {
    const doc = await open(page, "--comment-only");
    try {
      // The last paragraph on the page: a triple-click ends its selection inside the toolbar.
      const para = page.locator("footer[data-id]");
      await para.click({ clickCount: 3, position: { x: 5, y: 5 } });
      const toolbar = page.locator("#inplace-toolbar");
      await expect(toolbar.getByRole("button", { name: "Comment" })).toBeVisible();
      await toolbar.getByRole("button", { name: "Comment" }).click();
      const box = page.getByRole("dialog", { name: "Comment" });
      await expect(box.getByRole("textbox")).toBeVisible();
      await expect(page.locator("#inplace-status")).not.toContainText("Crossed-out");
      await box.getByRole("textbox").fill("Who wrote this?");
      await box.getByRole("button", { name: "Add comment" }).click();
      await expect.poll(() => doc.output).toContain(`comment #1 on footer-1 at "Prepared by the garden working group.`);
    } finally {
      doc.stop();
    }
  });

  test("--view-only: you can read the page and its comments, and nothing else", async ({ page }) => {
    const doc = await open(page, "--view-only");
    try {
      const para = block(page, "p", "The roof is already used");
      const id = await idOf(para);
      execFileSync(process.execPath, [CLI, "comment", id, "Is this right?", "--port", new URL(doc.url).port]);
      await expect(page.locator("#inplace-comment-layer .marker")).toHaveCount(1);
      await expect(page.locator("[contenteditable]")).toHaveCount(0);

      await selectText(para, "drying laundry");
      await expect(page.locator("#inplace-toolbar")).toBeHidden();
      await page.keyboard.press("Control+Alt+KeyM");
      await expect(page.getByRole("dialog", { name: "Comment" })).toBeHidden();

      // The comment can be read but not changed.
      await page.locator("#inplace-comment-layer .marker").click();
      const box = page.getByRole("dialog", { name: "Comment" });
      await expect(box).toContainText("Is this right?");
      await expect(box.getByRole("button", { name: /Answer|Dismiss|Edit|Delete/ })).toHaveCount(0);

      await page.locator("#inplace-corner").click();
      await expect(page.getByRole("dialog", { name: "Changes" })).toContainText("You can read this document, but not edit it or comment on it.");
    } finally {
      doc.stop();
    }
  });
});
