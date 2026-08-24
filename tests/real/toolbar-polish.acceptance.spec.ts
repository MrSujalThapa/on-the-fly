import type { Page } from "@playwright/test";
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
  const box = { nodeId: node.nodeId, x: (x0 + x2) / 2, y: (y0 + y2) / 2, width: x1 - x0, height: y2 - y0, disabled: attr(node, "disabled") !== null };
  await cdp.detach(); return box;
}
async function clickChrome(page: Page, className?: string, data?: [string, string]): Promise<boolean> {
  const node = await chromeNode(page, className, data);
  if (!node || node.disabled) return false;
  await page.mouse.click(node.x, node.y);
  return true;
}
async function setStyleField(page: Page, field: string, value: string): Promise<void> {
  const node = await chromeNode(page, undefined, ["data-style-field", field]);
  expect(node, `missing style field ${field}`).not.toBeNull();
  if (!node) return;
  const cdp = await page.context().newCDPSession(page);
  const resolved = await cdp.send("DOM.resolveNode", { nodeId: node.nodeId });
  const objectId = resolved.object.objectId;
  expect(objectId).toBeTruthy();
  if (objectId) {
    await cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function (next) { this.value = next; this.dispatchEvent(new Event("input", { bubbles: true })); }`,
      arguments: [{ value }],
    });
  }
  await cdp.detach();
}

test("toolbar polish on authenticated LinkedIn", async ({ page, context }) => {
  await requireLinkedInAuth(page); await clearPageOperations(context, page);
  await page.reload({ waitUntil: "domcontentloaded" }); const filters = await linkedInFilters(page); await enableEdit(context, page);

  await selectRealTarget(page, filters.Mentions);
  expect(await chromeNode(page, "otf-curved-toolbar")).toBeNull();
  await page.keyboard.press("t");
  await expect.poll(() => chromeNode(page, "otf-curved-toolbar")).not.toBeNull();
  await page.keyboard.press("t"); expect(await chromeNode(page, "otf-curved-toolbar")).toBeNull();
  await page.keyboard.press("Escape");
  await selectRealTarget(page, filters.Jobs);
  expect(await chromeNode(page, "otf-curved-toolbar")).toBeNull();
  await page.keyboard.press("t");
  await expect.poll(() => chromeNode(page, "otf-curved-toolbar")).not.toBeNull();
  await page.keyboard.press("Alt+ArrowUp");

  expect(await clickChrome(page, "otf-tool-btn", ["data-command-id", "style-panel"])).toBe(true);
  const panel = await chromeNode(page, "otf-style-panel");
  expect(panel?.width).toBeLessThanOrEqual(352);
  const header = await chromeNode(page, "otf-style-panel-header");
  expect(header).not.toBeNull();
  if (header && panel) {
    await page.mouse.move(header.x, header.y);
    await page.mouse.down();
    await page.mouse.move(header.x + 90, header.y + 70, { steps: 8 });
    await page.mouse.up();
    const moved = await chromeNode(page, "otf-style-panel");
    expect(Math.abs((moved?.x ?? 0) - panel.x) + Math.abs((moved?.y ?? 0) - panel.y)).toBeGreaterThan(20);
  }
  await setStyleField(page, "backgroundColor", "#ff0000");
  await setStyleField(page, "color", "#ffffff");
  expect(await clickChrome(page, undefined, ["data-style-apply", ""])).toBe(true);

  await selectRealTarget(page, filters.Mentions);
  await page.keyboard.press("t");
  await expect.poll(() => chromeNode(page, "otf-curved-toolbar")).not.toBeNull();
  const text = await chromeNode(page, "otf-tool-btn", ["data-command-id", "text-edit"]);
  expect(text?.disabled).toBe(false);
  if (text) await page.mouse.click(text.x, text.y);
  const editor = await chromeNode(page, "otf-text-editor-input");
  expect(editor).not.toBeNull();
  if (editor) {
    await page.mouse.click(editor.x, editor.y);
    await page.keyboard.press("End");
    await page.keyboard.type("t");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(" edited");
    await page.keyboard.press("Control+Enter");
  }
  await expect(page.getByText("Mentions edited", { exact: true }).first()).toBeVisible();

  const images = page.locator("main img:visible");
  await expect(images.first()).toBeVisible();
  const imageCount = Math.min(await images.count(), 3);
  expect(imageCount).toBeGreaterThanOrEqual(1);
  for (let index = 0; index < imageCount; index += 1) {
    await selectRealTarget(page, images.nth(index));
    if (!(await chromeNode(page, "otf-curved-toolbar"))) await page.keyboard.press("t");
    await expect.poll(() => chromeNode(page, "otf-curved-toolbar")).not.toBeNull();
    const crop = await chromeNode(page, "otf-tool-btn", ["data-command-id", "crop-mode"]);
    expect(crop?.disabled, `crop disabled for image ${String(index)}`).toBe(false);
    if (!crop || crop.disabled) continue;
    await page.mouse.click(crop.x, crop.y);
    const handle = await chromeNode(page, "otf-crop-handle", ["data-handle", "crop-se"]);
    expect(handle).not.toBeNull();
    if (!handle) continue;
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x - 12, handle.y - 12, { steps: 6 });
    await page.mouse.up();
  }
  await expect(page.locator("[data-otf-crop]")).toHaveCount(imageCount);

  await saveReal(page);
  await reloadLinkedInAndReplay(page, context);
  await expect(page.getByText("Mentions edited", { exact: true }).first()).toBeVisible();
  await expect(page.locator("[data-otf-crop]")).toHaveCount(imageCount);
});
