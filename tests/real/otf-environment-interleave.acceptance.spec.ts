import type { Page } from "@playwright/test";
import { getTransformHandleRect } from "../e2e/helpers/geometry.js";
import {
  clearPageOperations,
  dragRealTarget,
  enableEdit,
  expect,
  productFailure,
  saveReal,
  selectRealTarget,
  settleVisual,
  test,
} from "./harness.js";
import { linkedInFilters, reloadLinkedInAndReplay, requireLinkedInAuth } from "./linkedin.js";
import { env, envValue, requireExecute } from "./otf-env.js";

interface NodeInfo { nodeId: number; attributes?: string[]; children?: NodeInfo[]; shadowRoots?: NodeInfo[] }
interface SessionState {
  revision: number;
  dirty: boolean;
  selection: string[];
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
  await page.evaluate(() => {
    const close = Array.from(document.querySelectorAll("button")).find((button) =>
      /close jump menu/i.test(`${button.getAttribute("aria-label") ?? ""} ${button.textContent}`),
    );
    close?.click();
  });
}
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
}
async function expectSave(page: Page): Promise<void> {
  await saveReal(page);
  const host = page.locator("#on-the-fly-root-host");
  await expect.poll(async () => host.getAttribute("data-otf-save-status")).not.toBe("saving");
  const status = await host.getAttribute("data-otf-save-status");
  if (status === "failed") throw new Error(`SAVE FAILED: ${await host.getAttribute("data-otf-save-error") ?? "unknown"}`);
  expect(status, productFailure(`unexpected save status ${status ?? "null"}`)).toMatch(/^(saved|idle)$/u);
}
function createdById(page: Page, id: string) {
  return page.locator(`[data-otf-element-id="${id}"]`).first();
}
async function dragHandle(page: Page, handle: string, dx: number, dy: number): Promise<void> {
  const box = await getTransformHandleRect(page, handle);
  expect(box, productFailure(`missing ${handle} handle`)).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + dx, box.y + dy, { steps: 6 });
  await page.mouse.up();
  await settleVisual(page);
}
async function sessionState(page: Page): Promise<SessionState> {
  return envValue(await env(page, "getSessionState"), "getSessionState") as SessionState;
}
async function geometry(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  return envValue(await env(page, "getGeometry", id), `getGeometry ${id}`) as { x: number; y: number; width: number; height: number };
}
async function readSweep(page: Page, probeId: string): Promise<number> {
  const markerHtml = await page.evaluate(() => document.querySelector("[role='radiogroup']")?.outerHTML ?? "");
  const before = await sessionState(page);
  await env(page, "observe", { scope: "viewport" });
  await env(page, "inspectElement", probeId);
  await env(page, "getGeometry", probeId);
  await env(page, "getComputedStyles", probeId);
  await env(page, "findElements", { text: "Mentions", visibleOnly: true });
  await env(page, "getChanges");
  await env(page, "getSessionState");
  const after = await sessionState(page);
  const html = await page.evaluate(() => document.querySelector("[role='radiogroup']")?.outerHTML ?? "");
  expect(after.revision, productFailure("read API changed ledger revision")).toBe(before.revision);
  expect(after.dirty, productFailure("read API changed dirty state")).toBe(before.dirty);
  expect(after.selection, productFailure("read API changed selection")).toEqual(before.selection);
  expect(html, productFailure("read API mutated DOM")).toBe(markerHtml);
  return 7;
}

test("interleaved human and environment stress on LinkedIn", async ({ page, context }) => {
  test.setTimeout(720_000);
  await requireLinkedInAuth(page);
  await clearPageOperations(context, page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await linkedInFilters(page);
  await enableEdit(context, page);
  await dismissJumpMenu(page);

  let humanOps = 0;
  let filters = await linkedInFilters(page);
  let envOps = 0;
  let saves = 0;
  let reloads = 0;
  let readCalls = 0;
  const identities: Record<string, string[]> = {};

  const recordId = (label: string, id: string): void => {
    identities[label] = [...(identities[label] ?? []), id];
  };
  const assertStable = (label: string): void => {
    const seen = identities[label] ?? [];
    expect(new Set(seen).size, productFailure(`${label} aliased: ${seen.join(",")}`)).toBe(1);
  };

  await selectRealTarget(page, filters.Mentions);
  let mentionId = (envValue(await env(page, "observe", { scope: "selection" }), "mentions id") as { selection: string[] }).selection[0];
  expect(mentionId).toBeTruthy();
  if (!mentionId) return;
  recordId("host-filter", mentionId);
  await page.keyboard.press("Alt+ArrowUp");
  const barId = (envValue(await env(page, "observe", { scope: "selection" }), "filter bar id") as { selection: string[] }).selection[0];
  expect(barId).toBeTruthy();
  if (barId) recordId("host-bar", barId);

  const mentionsBox = await filters.Mentions.boundingBox();
  expect(mentionsBox).not.toBeNull();
  if (!mentionsBox) return;
  let placeX = mentionsBox.x + 24;
  let placeY = mentionsBox.y + 220;

  const createEnv = async (kind: "rectangle" | "button" | "container" | "search", width = 120, height = 48): Promise<string> => {
    const created = requireExecute(await env(page, "execute", {
      type: "create",
      kind,
      rect: { x: placeX, y: placeY, width, height },
    }), `env CREATE ${kind}`);
    envOps += 1;
    placeX += 18;
    placeY += 16;
    expect(created.target, productFailure(`env CREATE ${kind} missing target`)).toBeTruthy();
    if (!created.target) throw new Error("missing created target");
    return created.target;
  };

  const rectId = await createEnv("rectangle");
  recordId("created-rect", rectId);
  const buttonId = await createEnv("button");
  recordId("created-button", buttonId);
  const containerId = await createEnv("container", 280, 160);
  const liveRect = rectId;
  const liveButton = buttonId;
  const liveContainer = containerId;
  const spares: string[] = [];

  const envMove = async (id: string, dx: number, dy: number): Promise<void> => {
    requireExecute(await env(page, "execute", { type: "move", target: id, delta: { x: dx, y: dy } }), `env MOVE ${id}`);
    envOps += 1;
  };
  const envStyle = async (id: string, value: string): Promise<void> => {
    requireExecute(await env(page, "execute", { type: "style", target: id, property: "backgroundColor", value }), `env STYLE ${id}`);
    envOps += 1;
  };
  const envResize = async (ids: string[], dx = 16, dy = 10): Promise<void> => {
    const first = ids[0];
    expect(first, productFailure("env resize missing target")).toBeTruthy();
    if (!first) return;
    const boxes = await Promise.all(ids.map((id) => geometry(page, id)));
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    const toBounds = { x, y, width: (right - x) + dx, height: (bottom - y) + dy };
    requireExecute(await env(page, "execute", { type: "resize", targets: ids, toBounds }), `env RESIZE ${ids.join(",")}`);
    envOps += 1;
  };
  const envRotate = async (ids: string[], degrees: number): Promise<void> => {
    requireExecute(await env(page, "execute", { type: "rotate", targets: ids, degrees }), `env ROTATE ${ids.join(",")}`);
    envOps += 1;
  };
  const envLayer = async (id: string, command: "forward" | "backward"): Promise<void> => {
    requireExecute(await env(page, "execute", { type: "layer", target: id, command }), `env LAYER ${id}`);
    envOps += 1;
  };
  const envText = async (id: string, value: string): Promise<void> => {
    requireExecute(await env(page, "execute", { type: "text", target: id, value }), `env TEXT ${id}`);
    envOps += 1;
  };
  const envDelete = async (id: string): Promise<void> => {
    requireExecute(await env(page, "execute", { type: "delete", target: id }), `env DELETE ${id}`);
    envOps += 1;
  };
  const envDuplicate = async (id: string): Promise<string> => {
    const duplicated = requireExecute(await env(page, "execute", { type: "duplicate", target: id }), `env DUPLICATE ${id}`);
    envOps += 1;
    expect(duplicated.target, productFailure("duplicate missing clone id")).toBeTruthy();
    if (!duplicated.target) throw new Error("missing clone");
    return duplicated.target;
  };

  const humanSelectCreated = async (id: string): Promise<void> => {
    await selectRealTarget(page, createdById(page, id));
  };
  const humanMove = async (id: string, dx: number, dy: number): Promise<void> => {
    await humanSelectCreated(id);
    await dragRealTarget(page, createdById(page, id), dx, dy);
    humanOps += 1;
  };
  const humanResize = async (id: string): Promise<void> => {
    await humanSelectCreated(id);
    await dragHandle(page, "resize-se", 18, 12);
    humanOps += 1;
  };
  const humanRotate = async (id: string): Promise<void> => {
    await humanSelectCreated(id);
    await dragHandle(page, "rotate", 28, 6);
    humanOps += 1;
  };
  const humanLayer = async (id: string): Promise<void> => {
    await humanSelectCreated(id);
    await blur(page);
    await page.keyboard.press("Control+Shift+]");
    humanOps += 1;
  };
  const humanCopyPaste = async (id: string): Promise<void> => {
    await humanSelectCreated(id);
    await blur(page);
    await page.keyboard.press("Control+C");
    await page.keyboard.press("Control+V");
    humanOps += 1;
  };

  await envResize([liveRect, liveButton], 20, 12);
  await blur(page);
  await page.keyboard.press("Control+z");
  humanOps += 1;
  await envRotate([liveRect, liveButton], 12);
  await blur(page);
  await page.keyboard.press("Control+z");
  humanOps += 1;

  // Explicit interleaved history: env MOVE A, human undo/redo, human STYLE B, checkpoint, CREATE C, human resize C, rollback.
  const mentionBefore = await geometry(page, mentionId);
  await envMove(mentionId, 20, 8);
  recordId("host-filter", mentionId);
  await blur(page);
  await page.keyboard.press("Control+z");
  humanOps += 1;
  const afterUndo = await geometry(page, mentionId);
  expect(Math.abs(afterUndo.x - mentionBefore.x), productFailure("human undo did not reverse env MOVE")).toBeLessThan(8);
  await page.keyboard.press("Control+y");
  humanOps += 1;
  const afterRedo = await geometry(page, mentionId);
  expect(afterRedo.x - mentionBefore.x, productFailure("human redo did not restore env MOVE")).toBeGreaterThan(10);
  await openAndApplyHumanStyle(page, liveButton);
  humanOps += 1;
  const checkpoint = envValue(await env(page, "checkpoint", "interleave"), "checkpoint") as string;
  const revisionAtCheckpoint = (await sessionState(page)).revision;
  const createdC = await createEnv("search");
  await humanResize(createdC);
  const rolled = await env(page, "rollback", checkpoint);
  expect(rolled.ok, productFailure(`rollback failed: ${rolled.error?.message ?? "unknown"}`)).toBe(true);
  expect((await sessionState(page)).revision, productFailure("rollback did not restore checkpoint revision")).toBe(revisionAtCheckpoint);
  const afterRollback = await env(page, "inspectElement", createdC);
  expect(afterRollback.ok, productFailure("rollback left env CREATE C visible")).toBe(false);

  const cloneId = await envDuplicate(liveButton);
  recordId("clone", cloneId);

  const saveAt = new Set([4, 9, 14, 19, 24, 29, 34, 39, 44, 47]);
  const reloadAt = new Set([14, 29, 44]);

  for (let index = 0; index < 50; index += 1) {
    const humanKind = index % 10;
    if (humanKind === 0) await humanMove(liveRect, 8, 4);
    else if (humanKind === 1) await humanResize(liveRect);
    else if (humanKind === 2) await humanRotate(liveRect);
    else if (humanKind === 3) await humanLayer(liveButton);
    else if (humanKind === 4) {
      await selectRealTarget(page, filters.Mentions);
      await dragRealTarget(page, filters.Mentions, 6, 3);
      humanOps += 1;
      await dragHandle(page, "resize-se", 12, 8);
      humanOps += 1;
    } else if (humanKind === 5) await humanCopyPaste(liveButton);
    else if (humanKind === 6) await humanMove(liveContainer, 10, 6);
    else if (humanKind === 7) await humanResize(liveContainer);
    else if (humanKind === 8) await humanLayer(liveRect);
    else await humanRotate(liveButton);

    recordId("created-rect", liveRect);
    recordId("created-button", liveButton);

    const envKind = index % 10;
    if (envKind === 0) await envStyle(mentionId, index % 2 === 0 ? "rgb(255, 220, 220)" : "rgb(220, 220, 255)");
    else if (envKind === 1) await envMove(liveRect, 6, -3);
    else if (envKind === 2) await envResize([liveRect]);
    else if (envKind === 3) await envRotate([liveButton], 8);
    else if (envKind === 4) {
      const spare = await createEnv("rectangle", 72, 36);
      spares.push(spare);
    } else if (envKind === 5) await envLayer(liveButton, index % 2 === 0 ? "forward" : "backward");
    else if (envKind === 6) await envText(liveButton, `Env ${String(index)}`);
    else if (envKind === 7) await envResize([liveRect]);
    else if (envKind === 8) await envStyle(liveContainer, "rgb(240, 248, 255)");
    else if (spares.length > 0) {
      const spare = spares.pop();
      if (spare) await envDelete(spare);
      else await envMove(liveContainer, 4, 2);
    } else await envMove(liveContainer, 4, 2);

    if (index % 5 === 0) readCalls += await readSweep(page, liveRect);
    if (saveAt.has(index)) {
      await expectSave(page);
      saves += 1;
    }
    if (reloadAt.has(index)) {
      await reloadLinkedInAndReplay(page, context);
      reloads += 1;
      await dismissJumpMenu(page);
      filters = await linkedInFilters(page);
      await selectRealTarget(page, filters.Mentions);
      const rebound = (envValue(await env(page, "observe", { scope: "selection" }), "rebind mentions") as { selection: string[] }).selection[0];
      expect(rebound, productFailure("Mentions did not rebind after reload")).toBeTruthy();
      if (rebound) mentionId = rebound;
      recordId("created-rect", liveRect);
      recordId("created-button", liveButton);
      expect((await env(page, "inspectElement", liveRect)).ok, productFailure(`created rectangle lost after reload ${liveRect}`)).toBe(true);
      expect((await env(page, "inspectElement", liveButton)).ok, productFailure(`created button lost after reload ${liveButton}`)).toBe(true);
    }
  }

  while (humanOps < 50) {
    await humanMove(liveRect, 4, 2);
  }
  while (envOps < 50) {
    await envMove(liveRect, 3, 1);
  }

  await expectSave(page);
  saves += 1;

  assertStable("created-rect");
  assertStable("created-button");
  expect(humanOps, productFailure(`human ops ${String(humanOps)}`)).toBeGreaterThanOrEqual(50);
  expect(envOps, productFailure(`env ops ${String(envOps)}`)).toBeGreaterThanOrEqual(50);
  expect(saves, productFailure(`saves ${String(saves)}`)).toBeGreaterThanOrEqual(10);
  expect(reloads, productFailure(`reloads ${String(reloads)}`)).toBeGreaterThanOrEqual(3);
  expect(readCalls, productFailure("read sweep missing")).toBeGreaterThan(0);
});

async function openAndApplyHumanStyle(page: Page, id: string): Promise<void> {
  await selectRealTarget(page, page.locator(`[data-otf-element-id="${id}"]`).first());
  if (!(await chromeNode(page, "otf-curved-toolbar"))) await page.keyboard.press("t");
  await expect.poll(() => chromeNode(page, "otf-curved-toolbar")).not.toBeNull();
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "style-panel"])).toBe(true);
  await expect.poll(() => chromeNode(page, "otf-style-panel")).not.toBeNull();
  const cdp = await page.context().newCDPSession(page);
  const document = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const node = find(document.root, undefined, ["data-style-field", "backgroundColor"]);
  expect(node, productFailure("missing style backgroundColor field")).not.toBeNull();
  if (!node) { await cdp.detach(); return; }
  const resolved = await cdp.send("DOM.resolveNode", { nodeId: node.nodeId });
  const objectId = resolved.object.objectId;
  if (objectId) {
    await cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function (next) { this.value = next; this.dispatchEvent(new Event("input", { bubbles: true })); }`,
      arguments: [{ value: "#112233" }],
    });
  }
  await cdp.detach();
  expect(await invokeChrome(page, undefined, ["data-style-apply", ""])).toBe(true);
}
