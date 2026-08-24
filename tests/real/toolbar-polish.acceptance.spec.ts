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
  const box = { nodeId: node.nodeId, x: (x0 + x2) / 2, y: (y0 + y2) / 2, width: x1 - x0, height: y2 - y0, disabled: attr(node, "disabled") !== null };
  await cdp.detach(); return box;
}
async function clickChrome(page: Page, className?: string, data?: [string, string]): Promise<boolean> {
  const node = await chromeNode(page, className, data);
  if (!node || node.disabled) return false;
  await page.mouse.click(node.x, node.y);
  return true;
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

async function openStyle(page: Page): Promise<void> {
  if (!(await chromeNode(page, "otf-curved-toolbar"))) await page.keyboard.press("t");
  await expect.poll(() => chromeNode(page, "otf-curved-toolbar")).not.toBeNull();
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "style-panel"])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-style-panel")).not.toBeNull();
}

async function promoteSurface(page: Page): Promise<void> {
  for (let step = 0; step < 6; step += 1) {
    const overlay = await getOverlayRect(page);
    if (overlay && overlay.width >= 160 && overlay.height >= 64) return;
    await page.keyboard.press("Alt+ArrowUp");
  }
}

async function managedFill(page: Page): Promise<{ image: string; color: string } | null> {
  const overlay = await getOverlayRect(page);
  if (!overlay) return null;
  return page.evaluate((rect) => {
    const host = document.getElementById("on-the-fly-root-host");
    let best: HTMLElement | null = null;
    let bestDelta = Infinity;
    for (const node of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      if (host?.contains(node)) continue;
      const box = node.getBoundingClientRect();
      const delta = Math.abs(box.x - rect.x) + Math.abs(box.y - rect.y) + Math.abs(box.width - rect.width) + Math.abs(box.height - rect.height);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = node;
      }
    }
    const readFill = (node: HTMLElement | null): { image: string; color: string } | null => {
      const candidates: HTMLElement[] = [];
      let current = node;
      while (current && current !== document.body) {
        candidates.push(current);
        current = current.parentElement;
      }
      if (node) candidates.push(...Array.from(node.querySelectorAll<HTMLElement>("[style]")));
      const gradient = candidates.find((entry) => /linear-gradient/i.test(entry.style.backgroundImage));
      if (gradient) return { image: gradient.style.backgroundImage, color: gradient.style.backgroundColor };
      const solid = candidates.find((entry) => entry.style.backgroundColor && (entry.style.backgroundImage === "none" || entry.style.backgroundImage === ""));
      if (solid) return { image: solid.style.backgroundImage || "none", color: solid.style.backgroundColor };
      return null;
    };
    const matched = readFill(best);
    if (matched) return matched;
    let fallbackSolid: { image: string; color: string } | null = null;
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("[style]"))) {
      if (host?.contains(node)) continue;
      if (/linear-gradient/i.test(node.style.backgroundImage)) {
        return { image: node.style.backgroundImage, color: node.style.backgroundColor };
      }
      if (!fallbackSolid && node.style.backgroundColor && (node.style.backgroundImage === "none" || node.style.backgroundImage === "")) {
        fallbackSolid = { image: node.style.backgroundImage || "none", color: node.style.backgroundColor };
      }
    }
    return fallbackSolid;
  }, overlay);
}

async function overlayFill(page: Page, kind: "gradient" | "solid"): Promise<string> {
  const overlay = await getOverlayRect(page);
  if (!overlay) return "";
  return page.evaluate(({ rect, kind: mode }) => {
    const host = document.getElementById("on-the-fly-root-host");
    const hits: Array<{ image: string; color: string; area: number }> = [];
    for (const node of Array.from(document.body.querySelectorAll<HTMLElement>("[style]"))) {
      if (host?.contains(node)) continue;
      const box = node.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(box.right, rect.x + rect.width) - Math.max(box.left, rect.x))
        * Math.max(0, Math.min(box.bottom, rect.y + rect.height) - Math.max(box.top, rect.y));
      if (overlap <= 0) continue;
      hits.push({ image: node.style.backgroundImage, color: node.style.backgroundColor, area: overlap });
    }
    hits.sort((left, right) => right.area - left.area);
    if (mode === "gradient") {
      return hits.find((hit) => /linear-gradient/i.test(hit.image))?.image ?? "";
    }
    return hits.find((hit) => hit.color && !/linear-gradient/i.test(hit.image))?.color ?? "";
  }, { rect: overlay, kind });
}

async function expectGradientFill(page: Page): Promise<void> {
  await expect.poll(async () => overlayFill(page, "gradient")).toMatch(/linear-gradient/i);
}

async function expectSolidFill(page: Page): Promise<void> {
  await expect.poll(async () => overlayFill(page, "solid")).toMatch(/rgb|hsl|#/i);
}

async function prepareTarget(page: Page, target: Locator): Promise<void> {
  await selectRealTarget(page, target);
  await promoteSurface(page);
  await openStyle(page);
}

async function applyGradient(page: Page): Promise<void> {
  expect(await invokeChrome(page, "otf-gradient-chip", ["data-gradient-preset", "sunset"])).toBe(true);
  await expectGradientFill(page);
  expect(await invokeChrome(page, undefined, ["data-style-apply", ""])).toBe(true);
  await expectGradientFill(page);
}

async function applySolid(page: Page, color = "#ff0000"): Promise<void> {
  await setStyleField(page, "backgroundColor", color);
  await expectSolidFill(page);
  expect(await invokeChrome(page, undefined, ["data-style-apply", ""])).toBe(true);
  await expectSolidFill(page);
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
  expect(panel?.width).toBeGreaterThanOrEqual(298);
  expect(panel?.width).toBeLessThanOrEqual(322);
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
  if (!(await chromeNode(page, "otf-curved-toolbar"))) await page.keyboard.press("t");
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

test("solid background exits gradient on LinkedIn containers", async ({ page, context }) => {
  test.setTimeout(300_000);
  await requireLinkedInAuth(page); await clearPageOperations(context, page);
  await page.reload({ waitUntil: "domcontentloaded" }); const filters = await linkedInFilters(page); await enableEdit(context, page);
  const manage = page.getByRole("heading", { name: "Manage your notifications" });
  const sunset = /255,\s*107,\s*107|#ff6b6b/i;

  await prepareTarget(page, manage);
  await applyGradient(page);
  await openStyle(page);
  await applySolid(page, "#3b82f6");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await managedFill(page))?.image ?? "").toMatch(sunset);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await managedFill(page))?.image ?? "").not.toMatch(sunset);
  await page.keyboard.press("Control+y");
  await expect.poll(async () => (await managedFill(page))?.image ?? "").toMatch(sunset);
  await page.keyboard.press("Control+y");
  await expectSolidFill(page);

  await page.keyboard.press("Escape");

  const profile = page.getByRole("complementary").locator("a[href*='/in/']").nth(1);
  const notification = page.getByRole("main").getByText("Daily Rundown").first();
  const targets: Array<{ name: string; locator: Locator }> = [
    { name: "profile card", locator: profile },
    { name: "Manage your notifications", locator: manage },
    { name: "notification section", locator: notification },
    { name: "filter section", locator: filters.All },
  ];

  for (const target of targets) {
    await target.locator.scrollIntoViewIfNeeded();
    await prepareTarget(page, target.locator);
    await applyGradient(page);
    await openStyle(page);
    await applySolid(page, "#ff0000");
    await openStyle(page);
    await applyGradient(page);
    await openStyle(page);
    await applySolid(page, "#22c55e");
  }

  await saveReal(page);
  await reloadLinkedInAndReplay(page, context);
  await selectRealTarget(page, manage);
  await promoteSurface(page);
  await expectSolidFill(page);

  const reloaded = await linkedInFilters(page);
  await prepareTarget(page, reloaded.All);
  await applyGradient(page);
  await prepareTarget(page, profile);
  await applyGradient(page);
  await prepareTarget(page, notification);
  await applyGradient(page);
  await saveReal(page);
  await reloadLinkedInAndReplay(page, context);
  const after = await linkedInFilters(page);
  await selectRealTarget(page, profile);
  await promoteSurface(page);
  await expectGradientFill(page);
  await selectRealTarget(page, notification);
  await promoteSurface(page);
  await expectGradientFill(page);
  await selectRealTarget(page, after.All);
  await promoteSurface(page);
  const persistedGradients = await page.evaluate(() => {
    const host = document.getElementById("on-the-fly-root-host");
    return Array.from(document.querySelectorAll<HTMLElement>("[style]")).filter((node) =>
      !host?.contains(node) && /linear-gradient/i.test(node.style.backgroundImage)).length;
  });
  expect(persistedGradients).toBeGreaterThanOrEqual(2);
});
