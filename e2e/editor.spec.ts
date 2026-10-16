import { writeFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";

import { block, caretAfter, expect, hoverBlock, idOf, selectText, sourceOf, startDoc, test } from "./fixtures.ts";

const MOD = "ControlOrMeta";

test.describe("opening a document", () => {
  test("text blocks are editable, containers and charts are not", async ({ editor }) => {
    await expect(block(editor, "p", "The roof is already used")).toHaveAttribute("contenteditable", "true");
    await expect(block(editor, "td", "Raised beds")).toHaveAttribute("contenteditable", "true");
    await expect(editor.locator("table")).toHaveAttribute("data-id", /^table-/);
    await expect(editor.locator("table")).not.toHaveAttribute("contenteditable", "true");
    await expect(editor.locator("svg")).not.toHaveAttribute("contenteditable", "true");
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
    await expect(editor.locator("#inplace-status")).toHaveText("Moved");
    const html = doc.read();
    expect(html.indexOf(`data-id="${thirdId}"`)).toBeLessThan(html.indexOf(`data-id="${firstId}"`));
    expect(doc.output).toContain(`moved ${firstId} after ${thirdId}`);
  });
});

/** The text the page currently marks as changed words, in document order. */
const highlighted = (page: Page) => page.evaluate(() =>
  [...CSS.highlights.values()].flatMap((h) => [...h]).map((r) => r.toString()));

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
    await expect(corner).toBeHidden();
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
