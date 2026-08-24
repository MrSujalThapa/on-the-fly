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
  if (!node) { await cdp.detach(); return null; }
  const model = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId }).catch(() => null);
  if (!model) { await cdp.detach(); return null; }
  const q = model.model.border;
  const x0 = q[0]; const y0 = q[1]; const x1 = q[2]; const y2 = q[5]; const x2 = q[4];
  if (x0 === undefined || y0 === undefined || x1 === undefined || y2 === undefined || x2 === undefined) {
    await cdp.detach(); return null;
  }
  const box = { nodeId: node.nodeId, x: (x0 + x2) / 2, y: (y0 + y2) / 2, width: x1 - x0, height: y2 - y0 };
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
async function setStyleField(page: Page, field: string, value: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const document = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const node = find(document.root, undefined, ["data-style-field", field]);
  expect(node, `missing style field ${field}`).not.toBeNull();
  if (!node) { await cdp.detach(); return; }
  const resolved = await cdp.send("DOM.resolveNode", { nodeId: node.nodeId });
  const objectId = resolved.object.objectId;
  if (objectId) {
    await cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function (next) { this.value = next; this.dispatchEvent(new Event("input", { bubbles: true })); }`,
      arguments: [{ value }],
    });
  }
  await cdp.detach();
}
async function openStyle(page: Page): Promise<void> {
  if (!(await chromeNode(page, "otf-curved-toolbar"))) await page.keyboard.press("t");
  await expect.poll(() => chromeNode(page, "otf-curved-toolbar")).not.toBeNull();
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "style-panel"])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-style-panel")).not.toBeNull();
}
async function promote(page: Page, minWidth: number, minHeight: number): Promise<void> {
  for (let step = 0; step < 6; step += 1) {
    const overlay = await getOverlayRect(page);
    if (overlay && overlay.width >= minWidth && overlay.height >= minHeight) return;
    await page.keyboard.press("Alt+ArrowUp");
  }
}
async function overlayComputedFill(page: Page): Promise<{ color: string; image: string }> {
  const overlay = await getOverlayRect(page);
  expect(overlay, "selection overlay").not.toBeNull();
  if (!overlay) return { color: "", image: "none" };
  return page.evaluate((rect) => {
    const host = document.getElementById("on-the-fly-root-host");
    const transparent = (color: string) => {
      const value = color.trim().toLowerCase();
      return !value || value === "transparent" || value === "rgba(0, 0, 0, 0)";
    };
    for (const node of document.elementsFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) {
      if (!(node instanceof HTMLElement) || host?.contains(node)) continue;
      const style = getComputedStyle(node);
      if (style.backgroundImage !== "none" || !transparent(style.backgroundColor)) {
        return { color: style.backgroundColor, image: style.backgroundImage };
      }
    }
    return { color: "", image: "none" };
  }, overlay);
}
async function pillComputedColors(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.getElementById("on-the-fly-root-host");
    return Array.from(document.querySelectorAll<HTMLElement>("button.artdeco-pill"))
      .filter((node) => !host?.contains(node))
      .slice(0, 8)
      .map((node) => getComputedStyle(node).backgroundColor);
  });
}
async function prepare(page: Page, target: Locator, minWidth: number, minHeight: number): Promise<void> {
  await selectRealTarget(page, target);
  await promote(page, minWidth, minHeight);
  await openStyle(page);
}
async function previewSolid(page: Page, color: string, expected: RegExp): Promise<void> {
  await setStyleField(page, "backgroundColor", color);
  await expect.poll(async () => (await overlayComputedFill(page)).color).toMatch(expected);
}
async function applySolid(page: Page, color: string, expected: RegExp): Promise<void> {
  await previewSolid(page, color, expected);
  expect(await invokeChrome(page, undefined, ["data-style-apply", ""])).toBe(true);
  await expect.poll(async () => (await overlayComputedFill(page)).color).toMatch(expected);
  await expect.poll(async () => (await overlayComputedFill(page)).image).toBe("none");
}
async function applyGradient(page: Page): Promise<void> {
  expect(await invokeChrome(page, "otf-gradient-chip", ["data-gradient-preset", "sunset"])).toBe(true);
  await expect.poll(async () => (await overlayComputedFill(page)).image).toMatch(/linear-gradient/i);
  expect(await invokeChrome(page, undefined, ["data-style-apply", ""])).toBe(true);
  await expect.poll(async () => (await overlayComputedFill(page)).image).toMatch(/linear-gradient/i);
}

const RED = /255,\s*0,\s*0/;
const BLUE = /0,\s*0,\s*255/;
const GREEN = /0,\s*128,\s*0/;

test("solid fill paints LinkedIn card surfaces", async ({ page, context }) => {
  test.setTimeout(300_000);
  await requireLinkedInAuth(page);
  await clearPageOperations(context, page);
  await page.reload({ waitUntil: "domcontentloaded" });
  const filters = await linkedInFilters(page);
  await enableEdit(context, page);
  const manage = page.getByRole("heading", { name: "Manage your notifications" });

  await prepare(page, manage, 160, 64);
  await applyGradient(page);
  await applySolid(page, "#ff0000", RED);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await overlayComputedFill(page)).image).toMatch(/linear-gradient/i);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await overlayComputedFill(page)).image).not.toMatch(/linear-gradient/i);
  await expect.poll(async () => (await overlayComputedFill(page)).color).toMatch(/255,\s*255,\s*255/);
  await page.keyboard.press("Control+y");
  await expect.poll(async () => (await overlayComputedFill(page)).image).toMatch(/linear-gradient/i);
  await page.keyboard.press("Control+y");
  await expect.poll(async () => (await overlayComputedFill(page)).color).toMatch(RED);
  await applySolid(page, "#0000ff", BLUE);

  await page.keyboard.press("Escape");
  await prepare(page, filters.All, 280, 48);
  const pillsBefore = await pillComputedColors(page);
  await applySolid(page, "#ff0000", RED);
  await applySolid(page, "#0000ff", BLUE);
  await applyGradient(page);
  await applySolid(page, "#008000", GREEN);
  expect(await pillComputedColors(page)).toEqual(pillsBefore);
  await applySolid(page, "#ff0000", RED);

  await page.keyboard.press("Escape");
  const profile = page.getByRole("complementary").locator("a[href*='/in/']").nth(1);
  await prepare(page, profile, 160, 64);
  await applySolid(page, "#ff0000", RED);
  await applyGradient(page);

  await page.keyboard.press("Escape");
  await selectRealTarget(page, filters.Mentions);
  await openStyle(page);
  await applySolid(page, "#ff0000", RED);
  await page.keyboard.press("Control+z");

  await page.keyboard.press("Escape");
  const heading = page.getByRole("heading", { name: "Manage your notifications" });
  await selectRealTarget(page, heading);
  await openStyle(page);
  await setStyleField(page, "color", "#00ff00");
  expect(await invokeChrome(page, undefined, ["data-style-apply", ""])).toBe(true);
  await page.keyboard.press("Control+z");

  await saveReal(page);
  await reloadLinkedInAndReplay(page, context);
  await selectRealTarget(page, filters.All);
  await promote(page, 280, 48);
  await expect.poll(async () => (await overlayComputedFill(page)).color).toMatch(RED);
  await selectRealTarget(page, manage);
  await promote(page, 160, 64);
  await expect.poll(async () => (await overlayComputedFill(page)).color).toMatch(BLUE);
  await selectRealTarget(page, profile);
  await promote(page, 160, 64);
  await expect.poll(async () => (await overlayComputedFill(page)).image).toMatch(/linear-gradient/i);
});
