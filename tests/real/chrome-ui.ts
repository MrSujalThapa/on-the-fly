import type { CDPSession, Page } from "@playwright/test";
import {
  cdpAttr,
  cdpBox,
  describeOtfHost,
  findCdpNode,
  type CdpNode,
} from "../e2e/helpers/otf-cdp.js";
import { expect, dismissJumpMenu } from "./harness.js";

function find(node: CdpNode, className?: string, data?: [string, string]): CdpNode | null {
  return findCdpNode(node, (candidate) => {
    const classes = (cdpAttr(candidate, "class") ?? "").split(/\s+/u);
    const classOk = !className || classes.includes(className);
    const dataOk = !data || cdpAttr(candidate, data[0]) === data[1];
    return classOk && dataOk;
  });
}

async function resolveObjectId(cdp: CDPSession, node: CdpNode): Promise<string | null> {
  let nodeId = node.nodeId;
  if (!nodeId && node.backendNodeId) {
    const pushed = await cdp.send("DOM.pushNodesByBackendIdsToFrontend", {
      backendNodeIds: [node.backendNodeId],
    });
    nodeId = pushed.nodeIds[0];
  }
  if (!nodeId) {
    return null;
  }
  const resolved = await cdp.send("DOM.resolveNode", { nodeId }).catch(() => null);
  return resolved?.object.objectId ?? null;
}

export async function chromeNode(page: Page, className?: string, data?: [string, string]): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
} | null> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const host = await describeOtfHost(cdp);
    if (!host) {
      return null;
    }
    const node = find(host, className, data);
    if (!node || cdpAttr(node, "hidden") !== null) {
      return null;
    }
    const box = await cdpBox(cdp, node);
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
  } finally {
    await cdp.detach();
  }
}

export async function invokeChrome(page: Page, className?: string, data?: [string, string]): Promise<boolean> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const host = await describeOtfHost(cdp);
    if (!host) {
      return false;
    }
    const node = find(host, className, data);
    if (!node) {
      return false;
    }
    const objectId = await resolveObjectId(cdp, node);
    if (!objectId) {
      return false;
    }
    await cdp.send("Runtime.callFunctionOn", { objectId, functionDeclaration: "function () { this.click(); }" });
    return true;
  } finally {
    await cdp.detach();
  }
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

export async function applyOpacityFromToolbar(page: Page, value: string): Promise<void> {
  await openToolbar(page);
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "style-panel"])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-style-panel")).not.toBeNull();
  const cdp = await page.context().newCDPSession(page);
  try {
    const host = await describeOtfHost(cdp);
    expect(host, "opacity host missing").not.toBeNull();
    if (!host) {
      return;
    }
    const node = find(host, undefined, ["data-style-field", "opacity"]);
    expect(node, "opacity field missing").not.toBeNull();
    if (!node) {
      return;
    }
    const objectId = await resolveObjectId(cdp, node);
    expect(objectId).toBeTruthy();
    if (objectId) {
      await cdp.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function (next) { this.value = next; this.dispatchEvent(new Event("input", { bubbles: true })); }`,
        arguments: [{ value }],
      });
    }
  } finally {
    await cdp.detach();
  }
  expect(await invokeChrome(page, undefined, ["data-style-apply", ""])).toBe(true);
}

export async function invokeLayerCommand(page: Page, command: "front" | "back"): Promise<void> {
  if (command === "front") {
    await page.keyboard.press("Control+Shift+]");
    return;
  }
  await page.keyboard.press("Control+Shift+[");
}
