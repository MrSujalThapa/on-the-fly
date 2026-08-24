import type { Page } from "@playwright/test";
import { getOverlayRect, getTransformHandleRect } from "../e2e/helpers/geometry.js";
import { clearPageOperations, dragRealTarget, enableEdit, expect, loadSanitizedOperations, selectRealTarget, test } from "./harness.js";
import { linkedInFilters, reloadLinkedInAndReplay, requireLinkedInAuth } from "./linkedin.js";

interface NodeInfo { nodeId: number; attributes?: string[]; children?: NodeInfo[]; shadowRoots?: NodeInfo[] }
function attr(node: NodeInfo, name: string): string | null {
  const values = node.attributes ?? [];
  for (let i = 0; i < values.length; i += 2) if (values[i] === name) return values[i + 1] ?? null;
  return null;
}
function find(node: NodeInfo, className?: string, data?: [string, string]): NodeInfo | null {
  const classes = (attr(node, "class") ?? "").split(/\s+/u);
  const classOk = !className || classes.includes(className);
  const dataOk = !data || attr(node, data[0]) === data[1];
  if (classOk && dataOk) return node;
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
    const hit = find(child, className, data);
    if (hit) return hit;
  }
  return null;
}
async function chromeNode(page: Page, className?: string, data?: [string, string]) {
  const cdp = await page.context().newCDPSession(page);
  const document = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const node = find(document.root, className, data);
  if (!node || attr(node, "hidden") !== null) { await cdp.detach(); return null; }
  const model = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId }).catch(() => null);
  if (!model) { await cdp.detach(); return null; }
  const q = model.model.border;
  const x0 = q[0]; const y0 = q[1]; const x1 = q[2]; const y2 = q[5]; const x2 = q[4];
  if (x0 === undefined || y0 === undefined || x1 === undefined || y2 === undefined || x2 === undefined) {
    await cdp.detach(); return null;
  }
  const box = { x: (x0 + x2) / 2, y: (y0 + y2) / 2, width: x1 - x0, height: y2 - y0 };
  await cdp.detach(); return box;
}
async function invokeChrome(page: Page, className?: string, data?: [string, string]): Promise<boolean> {
  const cdp = await page.context().newCDPSession(page);
  const document = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const node = find(document.root, className, data);
  if (!node) { await cdp.detach(); return false; }
  const resolved = await cdp.send("DOM.resolveNode", { nodeId: node.nodeId }).catch(() => null);
  const objectId = resolved?.object.objectId;
  if (!objectId) { await cdp.detach(); return false; }
  await cdp.send("Runtime.callFunctionOn", { objectId, functionDeclaration: "function () { this.click(); }" });
  await cdp.detach();
  return true;
}
async function dismissJumpMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Close jump menu" }).click({ timeout: 800 }).catch(() => undefined);
}

async function openToolbar(page: Page): Promise<void> {
  if (await chromeNode(page, "otf-curved-toolbar")) return;
  await dismissJumpMenu(page);
  if (await chromeNode(page, "otf-curved-toolbar")) return;
  await page.keyboard.press("t");
  try {
    await expect.poll(() => chromeNode(page, "otf-curved-toolbar"), { timeout: 6_000 }).not.toBeNull();
  } catch {
    await dismissJumpMenu(page);
    await page.keyboard.press("t");
    await expect.poll(() => chromeNode(page, "otf-curved-toolbar")).not.toBeNull();
  }
}
async function createdCount(page: Page, kind?: string): Promise<number> {
  return page.evaluate((componentKind) => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-otf-element-id]:not([data-otf-preview])"));
    return componentKind ? nodes.filter((node) => node.getAttribute("data-otf-component-kind") === componentKind).length : nodes.length;
  }, kind);
}
async function createdIds(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll("[data-otf-element-id]:not([data-otf-preview])")).map((node) => node.getAttribute("data-otf-element-id") ?? ""));
}
async function addKind(page: Page, kind: string, x: number, y: number): Promise<void> {
  await openToolbar(page);
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "more"])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-more-menu")).not.toBeNull();
  expect(await invokeChrome(page, "otf-more-option", ["data-more-action", "add-element"])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-component-palette")).not.toBeNull();
  expect(await invokeChrome(page, "otf-palette-item", ["data-create-kind", kind])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-component-palette")).toBeNull();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 36, y + 28, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => createdCount(page, kind)).toBeGreaterThan(0);
}

const KINDS = ["rectangle", "circle", "divider", "text", "heading", "button", "input", "search", "badge", "container", "card", "header"] as const;

test("create elements, sample styles, and wrap on LinkedIn", async ({ page, context }) => {
  test.setTimeout(420_000);
  await requireLinkedInAuth(page);
  await clearPageOperations(context, page);
  await page.reload({ waitUntil: "domcontentloaded" });
  const filters = await linkedInFilters(page);
  await enableEdit(context, page);

  const mentions = await filters.Mentions.boundingBox();
  expect(mentions).not.toBeNull();
  if (!mentions) return;
  await selectRealTarget(page, filters.All);
  await openToolbar(page);
  let placeX = mentions.x;
  let placeY = mentions.y + 220;

  for (const kind of KINDS) {
    const before = await createdCount(page, kind);
    await addKind(page, kind, placeX, placeY);
    expect(await createdCount(page, kind), kind).toBe(before + 1);
    placeX += 18;
    placeY += 18;
  }

  await selectRealTarget(page, filters.Jobs);
  await openToolbar(page);
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "more"])).toBe(true);
  expect(await invokeChrome(page, "otf-more-option", ["data-more-action", "add-element"])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-palette-sample")).not.toBeNull();
  expect(await invokeChrome(page, undefined, ["data-palette-style", "sampled"])).toBe(true);
  expect(await invokeChrome(page, "otf-palette-item", ["data-create-kind", "badge"])).toBe(true);
  await page.mouse.click(placeX + 40, placeY + 40);
  const sampledBadge = page.locator('[data-otf-component-kind="badge"]').last();
  await expect(sampledBadge).toBeVisible();
  const radius = await sampledBadge.evaluate((node) => getComputedStyle(node).borderRadius);
  expect(Number.parseFloat(radius)).toBeGreaterThan(8);

  const manage = page.getByRole("heading", { name: "Manage your notifications" });
  await selectRealTarget(page, manage);
  await openToolbar(page);
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "more"])).toBe(true);
  expect(await invokeChrome(page, "otf-more-option", ["data-more-action", "add-element"])).toBe(true);
  expect(await invokeChrome(page, undefined, ["data-palette-style", "sampled"])).toBe(true);
  expect(await invokeChrome(page, "otf-palette-item", ["data-create-kind", "card"])).toBe(true);
  await page.mouse.click(placeX + 80, placeY + 90);
  await expect.poll(() => createdCount(page, "card")).toBeGreaterThan(1);

  const settings = page.getByRole("link", { name: "View settings" });
  await selectRealTarget(page, settings);
  const hostParent = await settings.evaluate((node) => node.parentElement?.tagName ?? "");
  await openToolbar(page);
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "more"])).toBe(true);
  expect(await invokeChrome(page, "otf-more-option", ["data-more-action", "wrap-selection"])).toBe(true);
  await expect.poll(() => createdCount(page, "container")).toBeGreaterThan(1);
  expect(await settings.evaluate((node) => node.parentElement?.tagName ?? "")).toBe(hostParent);
  expect(await getOverlayRect(page)).not.toBeNull();

  await page.locator('[data-otf-component-kind="button"]').first().click({ force: true, position: { x: 8, y: 8 } });
  await page.keyboard.press("Control+C");
  await page.keyboard.press("Control+V");
  await page.keyboard.press("Control+V");
  await page.keyboard.press("Control+V");
  const ids = await createdIds(page);
  expect(new Set(ids).size).toBe(ids.length);

  let saves = 0;
  for (let index = 0; index < 10; index += 1) {
    expect(await invokeChrome(page, "otf-save-button")).toBe(true);
    await page.evaluate(() => new Promise<void>((resolve) => { window.setTimeout(resolve, 400); }));
    saves += 1;
  }
  const beforeReload = await createdIds(page);
  const persisted = await loadSanitizedOperations(context, page);
  const createdPersisted = persisted.filter((operation) => operation.type === "createElement").map((operation) => operation.nodeId);
  expect(createdPersisted).toEqual(beforeReload);
  await reloadLinkedInAndReplay(page, context);
  await expect.poll(() => createdIds(page), { timeout: 30_000 }).toEqual(beforeReload);
  expect(saves).toBe(10);
});

test("toolbar, created movement, wrap, layer, and resize after move on LinkedIn", async ({ page, context }) => {
  test.setTimeout(240_000);
  await requireLinkedInAuth(page);
  await clearPageOperations(context, page);
  await page.reload({ waitUntil: "domcontentloaded" });
  const filters = await linkedInFilters(page);
  await enableEdit(context, page);
  await dismissJumpMenu(page);
  await page.mouse.click(24, 320);
  await page.keyboard.press("Escape");
  await dismissJumpMenu(page);
  await page.keyboard.press("t");
  await expect.poll(() => chromeNode(page, "otf-curved-toolbar")).not.toBeNull();
  await page.keyboard.press("t");
  expect(await chromeNode(page, "otf-curved-toolbar")).toBeNull();
  const search = page.locator('input[placeholder*="Search"]').first();
  if (await search.count()) {
    await search.click({ timeout: 2_000 }).catch(() => undefined);
    await page.keyboard.type("t");
    expect(await chromeNode(page, "otf-curved-toolbar")).toBeNull();
    await page.keyboard.press("Escape");
  }
  const mentions = await filters.Mentions.boundingBox();
  expect(mentions).not.toBeNull();
  if (!mentions) return;
  await addKind(page, "rectangle", mentions.x, mentions.y + 200);
  const created = page.locator("[data-otf-component-kind='rectangle']").last();
  const before = await created.boundingBox();
  await dragRealTarget(page, created, 36, 18);
  const moved = await created.boundingBox();
  expect(Math.abs((moved?.x ?? 0) - ((before?.x ?? 0) + 36))).toBeLessThan(16);
  let handle = await getTransformHandleRect(page, "resize-se");
  expect(handle).not.toBeNull();
  if (handle) {
    await page.mouse.move(handle.x + 4, handle.y + 4);
    await page.mouse.down();
    await page.mouse.move(handle.x + 28, handle.y + 16, { steps: 6 });
    await page.mouse.up();
  }
  const settings = page.getByRole("link", { name: "View settings" });
  await selectRealTarget(page, settings);
  await openToolbar(page);
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "more"])).toBe(true);
  expect(await invokeChrome(page, "otf-more-option", ["data-more-action", "wrap-selection"])).toBe(true);
  await expect.poll(() => createdCount(page, "container")).toBeGreaterThan(0);
  expect(await chromeNode(page, "otf-selection-member-outline")).toBeNull();
  await selectRealTarget(page, filters.All);
  await page.keyboard.press("Alt+ArrowUp");
  const filterBefore = await filters.All.boundingBox();
  handle = await getTransformHandleRect(page, "resize-se");
  expect(handle).not.toBeNull();
  await dragRealTarget(page, filters.All, 24, 16);
  handle = await getTransformHandleRect(page, "resize-se");
  expect(handle).not.toBeNull();
  if (handle) {
    await page.mouse.move(handle.x + 4, handle.y + 4);
    await page.mouse.down();
    await page.mouse.move(handle.x + 22, handle.y + 10, { steps: 5 });
    await page.mouse.up();
  }
  expect(filterBefore).not.toBeNull();
});
