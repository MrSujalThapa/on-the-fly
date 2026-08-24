import type { Locator, Page } from "@playwright/test";
import { getOverlayRect } from "../e2e/helpers/geometry.js";
import { clearPageOperations, enableEdit, expect, saveReal, selectRealTarget, test } from "./harness.js";
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
  const box = { x: (x0 + x2) / 2, y: (y0 + y2) / 2, width: x1 - x0, height: y2 - y0, disabled: attr(node, "disabled") !== null };
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
async function openToolbar(page: Page): Promise<void> {
  if (!(await chromeNode(page, "otf-curved-toolbar"))) await page.keyboard.press("t");
  await expect.poll(() => chromeNode(page, "otf-curved-toolbar")).not.toBeNull();
}
async function armLasso(page: Page, mode: "rectangle" | "freeform"): Promise<void> {
  await openToolbar(page);
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "lasso"])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-lasso-chooser")).not.toBeNull();
  expect(await invokeChrome(page, "otf-lasso-option", ["data-lasso-mode", mode])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-lasso-chooser")).toBeNull();
}
async function boxOf(target: Locator) {
  const box = await target.boundingBox();
  expect(box, "target box").not.toBeNull();
  if (!box) throw new Error("target box");
  return box;
}
async function shiftDrag(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.keyboard.down("Shift");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
}
async function drag(page: Page, x: number, y: number, dx: number, dy: number, steps = 12): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps });
  await page.mouse.up();
}
async function freeformLoop(page: Page, points: Array<{ x: number; y: number }>): Promise<void> {
  const first = points[0];
  if (!first) return;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 3 });
  await page.mouse.up();
}

test("toolbar lasso rectangle and freeform on LinkedIn", async ({ page, context }) => {
  test.setTimeout(300_000);
  await requireLinkedInAuth(page);
  await clearPageOperations(context, page);
  await page.reload({ waitUntil: "domcontentloaded" });
  const filters = await linkedInFilters(page);
  await enableEdit(context, page);

  const all = await boxOf(filters.All);
  const jobs = await boxOf(filters.Jobs);
  const posts = await boxOf(filters["My posts"]);
  const mentions = await boxOf(filters.Mentions);
  let regressions = 0;
  for (let index = 0; index < 10; index += 1) {
    await shiftDrag(page, all.x - 8, all.y - 8, mentions.x + mentions.width - all.x + 16, mentions.height + 24);
    const overlay = await getOverlayRect(page);
    if (!overlay || overlay.width < 40) regressions += 1;
  }
  expect(regressions, "shift-drag rectangle regressions").toBe(0);

  await selectRealTarget(page, filters.All);
  await armLasso(page, "rectangle");
  await drag(page, all.x - 10, all.y - 10, posts.x + posts.width - all.x + 20, all.height + 28);
  const toolbarRect = await getOverlayRect(page);
  expect(toolbarRect?.width).toBeGreaterThan(80);

  await page.keyboard.press("Escape");
  await selectRealTarget(page, filters.All);
  await armLasso(page, "freeform");
  await freeformLoop(page, [
    { x: posts.x - 12, y: posts.y - 12 },
    { x: mentions.x + mentions.width + 12, y: posts.y - 12 },
    { x: mentions.x + mentions.width + 12, y: mentions.y + mentions.height + 12 },
    { x: posts.x - 12, y: mentions.y + mentions.height + 12 },
    { x: posts.x - 12, y: posts.y - 12 },
  ]);
  const postsMentions = await getOverlayRect(page);
  expect(postsMentions?.width).toBeGreaterThan(80);

  await selectRealTarget(page, filters.All);
  await armLasso(page, "freeform");
  await freeformLoop(page, [
    { x: posts.x - 4, y: posts.y - 10 },
    { x: mentions.x + mentions.width + 10, y: posts.y - 10 },
    { x: mentions.x + mentions.width + 10, y: mentions.y + mentions.height + 10 },
    { x: posts.x - 4, y: mentions.y + mentions.height + 10 },
    { x: posts.x + 18, y: posts.y + posts.height / 2 },
    { x: posts.x - 4, y: posts.y - 10 },
  ]);
  const irregular = await getOverlayRect(page);
  expect(irregular?.width).toBeGreaterThan(40);
  expect((irregular?.x ?? 0) + 8).toBeGreaterThan(jobs.x + jobs.width);

  await selectRealTarget(page, filters["My posts"]);
  await page.keyboard.press("t");
  await page.keyboard.press("Control+g");
  await page.keyboard.press("Escape");
  await selectRealTarget(page, filters.All);
  await armLasso(page, "freeform");
  await freeformLoop(page, [
    { x: mentions.x - 8, y: mentions.y - 8 },
    { x: mentions.x + mentions.width + 8, y: mentions.y - 8 },
    { x: mentions.x + mentions.width + 8, y: mentions.y + mentions.height + 8 },
    { x: mentions.x - 8, y: mentions.y + mentions.height + 8 },
  ]);
  const grouped = await getOverlayRect(page);
  expect(grouped?.width).toBeGreaterThan(mentions.width);

  await selectRealTarget(page, filters.All);
  await armLasso(page, "freeform");
  await page.keyboard.down("Shift");
  await freeformLoop(page, [
    { x: posts.x - 8, y: posts.y - 8 },
    { x: mentions.x + mentions.width + 8, y: posts.y - 8 },
    { x: mentions.x + mentions.width + 8, y: mentions.y + mentions.height + 8 },
    { x: posts.x - 8, y: mentions.y + mentions.height + 8 },
  ]);
  await page.keyboard.up("Shift");
  const additive = await getOverlayRect(page);
  expect(additive?.width).toBeGreaterThan(posts.width);

  await selectRealTarget(page, filters.Jobs);
  await armLasso(page, "freeform");
  await freeformLoop(page, [
    { x: all.x - 12, y: all.y - 12 },
    { x: mentions.x + mentions.width + 12, y: all.y - 12 },
    { x: mentions.x + mentions.width + 12, y: mentions.y + mentions.height + 12 },
    { x: all.x - 12, y: mentions.y + mentions.height + 12 },
  ]);
  await page.keyboard.press("Control+g");
  const union = await getOverlayRect(page);
  expect(union?.width).toBeGreaterThan(120);
  await page.mouse.move((union?.x ?? 0) + 20, (union?.y ?? 0) + 10);
  await page.mouse.down();
  await page.mouse.move((union?.x ?? 0) + 50, (union?.y ?? 0) + 40, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");

  await selectRealTarget(page, filters.All);
  await armLasso(page, "freeform");
  await freeformLoop(page, [
    { x: jobs.x - 8, y: jobs.y - 8 },
    { x: posts.x + posts.width + 8, y: jobs.y - 8 },
    { x: posts.x + posts.width + 8, y: posts.y + posts.height + 8 },
    { x: jobs.x - 8, y: posts.y + posts.height + 8 },
  ]);
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+z");

  await selectRealTarget(page, filters.Mentions);
  await armLasso(page, "freeform");
  await freeformLoop(page, [
    { x: posts.x - 8, y: posts.y - 8 },
    { x: mentions.x + mentions.width + 8, y: posts.y - 8 },
    { x: mentions.x + mentions.width + 8, y: mentions.y + mentions.height + 8 },
    { x: posts.x - 8, y: mentions.y + mentions.height + 8 },
  ]);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");

  await selectRealTarget(page, filters.All);
  await armLasso(page, "rectangle");
  await drag(page, all.x - 8, all.y - 8, 40, 30);
  await page.keyboard.press("Escape");
  await selectRealTarget(page, filters.All);
  await armLasso(page, "freeform");
  await page.keyboard.press("Escape");
  expect(await chromeNode(page, "otf-lasso-chooser")).toBeNull();

  await selectRealTarget(page, filters.All);
  await armLasso(page, "freeform");
  const scribble: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < 220; index += 1) {
    const angle = (index / 220) * Math.PI * 2;
    scribble.push({ x: all.x + 180 + Math.cos(angle) * (80 + index * 0.2), y: all.y + 220 + Math.sin(angle) * (120 + index * 0.15) });
  }
  await freeformLoop(page, scribble);
  const stats = await page.locator("#on-the-fly-root-host").getAttribute("data-otf-freeform-stats");
  expect(stats).toBeTruthy();
  console.log(`FREEFORM STATS ${stats ?? ""}`);

  const manage = page.getByRole("heading", { name: "Manage your notifications" });
  await selectRealTarget(page, manage);
  await armLasso(page, "freeform");
  const manageBox = await boxOf(manage);
  await freeformLoop(page, [
    { x: manageBox.x - 20, y: manageBox.y - 20 },
    { x: manageBox.x + manageBox.width + 40, y: manageBox.y - 20 },
    { x: manageBox.x + manageBox.width + 40, y: manageBox.y + 90 },
    { x: manageBox.x - 20, y: manageBox.y + 90 },
  ]);
  await openToolbar(page);
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "style-panel"])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-style-panel")).not.toBeNull();
  await expect.poll(() => chromeNode(page, undefined, ["data-style-field", "backgroundColor"])).not.toBeNull();
  const colorField = await chromeNode(page, undefined, ["data-style-field", "backgroundColor"]);
  if (colorField) {
    const cdp = await page.context().newCDPSession(page);
    const document = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
    const node = find(document.root, undefined, ["data-style-field", "backgroundColor"]);
    if (node) {
      const resolved = await cdp.send("DOM.resolveNode", { nodeId: node.nodeId });
      if (resolved.object.objectId) {
        await cdp.send("Runtime.callFunctionOn", {
          objectId: resolved.object.objectId,
          functionDeclaration: `function (next) { this.value = next; this.dispatchEvent(new Event("input", { bubbles: true })); }`,
          arguments: [{ value: "#ff0000" }],
        });
      }
    }
    await cdp.detach();
    expect(await invokeChrome(page, undefined, ["data-style-apply", ""])).toBe(true);
  }
  await saveReal(page);
  await reloadLinkedInAndReplay(page, context);
  await expect.poll(async () => page.locator("[data-otf-managed='true']").count()).toBeGreaterThan(0);
});
