import type { Page } from "@playwright/test";
import { expect } from "./harness.js";

interface NodeInfo {
  nodeId: number;
  attributes?: string[];
  children?: NodeInfo[];
  shadowRoots?: NodeInfo[];
}

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

export async function chromeNode(page: Page, className?: string, data?: [string, string]): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
} | null> {
  const cdp = await page.context().newCDPSession(page);
  const document = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const node = find(document.root, className, data);
  if (!node || attr(node, "hidden") !== null) {
    await cdp.detach();
    return null;
  }
  const model = await cdp.send("DOM.getBoxModel", { nodeId: node.nodeId }).catch(() => null);
  if (!model) {
    await cdp.detach();
    return null;
  }
  const q = model.model.border;
  const x0 = q[0];
  const y0 = q[1];
  const x1 = q[2];
  const y2 = q[5];
  const x2 = q[4];
  if (x0 === undefined || y0 === undefined || x1 === undefined || y2 === undefined || x2 === undefined) {
    await cdp.detach();
    return null;
  }
  const box = { x: (x0 + x2) / 2, y: (y0 + y2) / 2, width: x1 - x0, height: y2 - y0 };
  await cdp.detach();
  return box;
}

export async function invokeChrome(page: Page, className?: string, data?: [string, string]): Promise<boolean> {
  const cdp = await page.context().newCDPSession(page);
  const document = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const node = find(document.root, className, data);
  if (!node) {
    await cdp.detach();
    return false;
  }
  const resolved = await cdp.send("DOM.resolveNode", { nodeId: node.nodeId }).catch(() => null);
  const objectId = resolved?.object.objectId;
  if (!objectId) {
    await cdp.detach();
    return false;
  }
  await cdp.send("Runtime.callFunctionOn", { objectId, functionDeclaration: "function () { this.click(); }" });
  await cdp.detach();
  return true;
}

async function dismissJumpMenu(page: Page): Promise<void> {
  await page.evaluate(() => {
    const close = Array.from(document.querySelectorAll("button")).find((button) =>
      /close jump menu/i.test(`${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`),
    );
    close?.click();
  });
}

export async function openToolbar(page: Page): Promise<void> {
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

export async function armLassoFromToolbar(page: Page, mode: "rectangle" | "freeform"): Promise<void> {
  await openToolbar(page);
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "lasso"])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-lasso-chooser")).not.toBeNull();
  expect(await invokeChrome(page, "otf-lasso-option", ["data-lasso-mode", mode])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-lasso-chooser")).toBeNull();
}

export async function createKindFromToolbar(page: Page, kind: string, x: number, y: number): Promise<void> {
  await openToolbar(page);
  await dismissJumpMenu(page);
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "more"])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-more-menu")).not.toBeNull();
  expect(await invokeChrome(page, "otf-more-option", ["data-more-action", "add-element"])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-component-palette")).not.toBeNull();
  expect(await invokeChrome(page, "otf-palette-item", ["data-create-kind", kind])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-component-palette")).toBeNull();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 48, { steps: 8 });
  await page.mouse.up();
}

export async function invokeLayerCommand(page: Page, command: "front" | "back"): Promise<void> {
  if (command === "front") {
    await page.keyboard.press("Control+Shift+]");
    return;
  }
  await page.keyboard.press("Control+Shift+[");
}
