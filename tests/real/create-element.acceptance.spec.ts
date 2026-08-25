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
  await page.evaluate(() => {
    const close = Array.from(document.querySelectorAll("button")).find((button) =>
      /close jump menu/i.test(`${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`),
    );
    close?.click();
  });
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
  await dismissJumpMenu(page);
  expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "more"])).toBe(true);
  try {
    await expect.poll(() => chromeNode(page, "otf-more-menu"), { timeout: 6_000 }).not.toBeNull();
  } catch {
    await dismissJumpMenu(page);
    await openToolbar(page);
    expect(await invokeChrome(page, "otf-tool-btn", ["data-command-id", "more"])).toBe(true);
    await expect.poll(() => chromeNode(page, "otf-more-menu")).not.toBeNull();
  }
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
    await page.keyboard.press("i");
    await search.click({ timeout: 2_000 }).catch(() => undefined);
    await page.keyboard.type("t");
    expect(await chromeNode(page, "otf-curved-toolbar")).toBeNull();
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    await page.keyboard.press("i");
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
  const bar = page.locator("[role='radiogroup']").first();
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();
  await addKind(page, "rectangle", mentions.x, (barBox?.y ?? mentions.y) + Math.max(0, ((barBox?.height ?? mentions.height) / 2) - 14));
  const overlap = page.locator("[data-otf-component-kind='rectangle']").last();
  const overlapBox = await overlap.boundingBox();
  expect(overlapBox).not.toBeNull();
  await selectRealTarget(page, filters.All);
  await dismissJumpMenu(page);
  for (let step = 0; step < 8; step += 1) {
    const outline = await getOverlayRect(page);
    if (outline && barBox && Math.abs(outline.width - barBox.width) < 48 && Math.abs(outline.height - barBox.height) < 48) break;
    await page.keyboard.press("Alt+ArrowUp");
  }
  const selectedBar = await getOverlayRect(page);
  expect(selectedBar && barBox && Math.abs((selectedBar?.width ?? 0) - barBox.width) < 48).toBe(true);
  await dismissJumpMenu(page);
  const overlapPoint = {
    x: Math.round((overlapBox?.x ?? 0) + Math.min(24, Math.max(8, (overlapBox?.width ?? 16) / 2))),
    y: Math.round((overlapBox?.y ?? 0) + Math.min(12, Math.max(6, (overlapBox?.height ?? 12) / 2))),
  };
  const paintTop = async (): Promise<string> => page.evaluate(({ x, y }) => {
    for (const node of document.elementsFromPoint(x, y)) {
      if (!(node instanceof HTMLElement) || node.closest("#on-the-fly-root-host")) continue;
      const created = node.closest("[data-otf-element-id]");
      if (created) return `created:${created.getAttribute("data-otf-element-id") ?? ""}`;
      const detached = node.closest("[data-otf-detached='true']");
      if (detached) return `host:${detached.tagName}`;
      const bar = node.closest("[role='radiogroup']");
      if (bar) return `bar:${bar.getAttribute("data-otf-detached") ?? "attached"}`;
    }
    return "other";
  }, overlapPoint);
  await page.keyboard.press("Control+Shift+]");
  await expect.poll(async () => page.evaluate(() =>
    Boolean(document.querySelector("[role='radiogroup']")?.getAttribute("data-otf-detached") === "true"
      || document.querySelector("[role='radio']")?.closest("[data-otf-detached='true']")),
  )).toBe(true);
  const zFront = await page.evaluate(() => {
    const bar = document.querySelector("[role='radiogroup']");
    return bar instanceof HTMLElement ? bar.style.zIndex : "";
  });
  const hostFront = await paintTop();
  await page.keyboard.press("Control+Shift+[");
  await page.keyboard.press("Control+Shift+[");
  const zBack = await page.evaluate(() => {
    const bar = document.querySelector("[role='radiogroup']");
    return bar instanceof HTMLElement ? bar.style.zIndex : "";
  });
  const hostBack = await paintTop();
  expect(Number.parseInt(zBack || "0", 10)).toBeGreaterThanOrEqual(1);
  expect(zFront === zBack && hostFront === hostBack).toBe(false);
  handle = await getTransformHandleRect(page, "resize-se");
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

const RESIZE_KINDS = ["rectangle", "container", "card", "button", "search"] as const;
const MIXED_HANDLES = [
  { handle: "resize-se", dx: 14, dy: 10 },
  { handle: "resize-nw", dx: 14, dy: 10 },
  { handle: "resize-sw", dx: -12, dy: 10 },
  { handle: "resize-ne", dx: 12, dy: 10 },
] as const;

function mixedHandle(index: number): (typeof MIXED_HANDLES)[number] {
  const step = MIXED_HANDLES[index % MIXED_HANDLES.length];
  if (!step) throw new Error("missing resize handle step");
  return step;
}

async function createdProbe(page: Page, kind: string) {
  return page.evaluate((componentKind) => {
    const el = Array.from(document.querySelectorAll<HTMLElement>("[data-otf-element-id]:not([data-otf-preview])"))
      .find((node) => node.getAttribute("data-otf-component-kind") === componentKind);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return {
      elementId: el.getAttribute("data-otf-element-id"),
      isConnected: el.isConnected,
      probe: el.dataset.otfResizeProbe ?? "",
      world: { x: box.x, y: box.y, width: box.width, height: box.height },
      inlineWidth: el.style.width,
      inlineHeight: el.style.height,
      computedWidth: getComputedStyle(el).width,
      computedHeight: getComputedStyle(el).height,
      boxSizing: getComputedStyle(el).boxSizing,
      minWidth: getComputedStyle(el).minWidth,
      transform: el.getAttribute("data-otf-transform"),
      detached: el.getAttribute("data-otf-detached"),
    };
  }, kind);
}

async function markCreatedRoot(page: Page, kind: string): Promise<string | null> {
  return page.evaluate((componentKind) => {
    const el = Array.from(document.querySelectorAll<HTMLElement>("[data-otf-element-id]:not([data-otf-preview])"))
      .find((node) => node.getAttribute("data-otf-component-kind") === componentKind);
    if (!el) return null;
    el.dataset.otfResizeProbe = "stable-root";
    return el.getAttribute("data-otf-element-id");
  }, kind);
}

async function selectCreated(page: Page, kind: string): Promise<void> {
  await dismissJumpMenu(page);
  await page.locator(`[data-otf-component-kind="${kind}"]:not([data-otf-preview])`).last().click({
    force: true,
    position: { x: 8, y: 8 },
  });
  await expect.poll(async () => {
    const outline = await getOverlayRect(page);
    const live = await createdProbe(page, kind);
    if (!outline || !live) return `missing:${JSON.stringify({ outline, live })}`;
    const aligned = Math.abs(outline.width - live.world.width) < 24 && Math.abs(outline.height - live.world.height) < 24
      && Math.abs(outline.x - live.world.x) < 24 && Math.abs(outline.y - live.world.y) < 24;
    return aligned ? "ok" : `mismatch:${JSON.stringify({ outline, live })}`;
  }, { timeout: 8_000 }).toBe("ok");
}

async function dragCreated(page: Page, kind: string, dx: number, dy: number): Promise<void> {
  await dismissJumpMenu(page);
  const probe = await createdProbe(page, kind);
  expect(probe, `${kind} missing before move`).not.toBeNull();
  if (!probe) return;
  const x = probe.world.x + Math.max(16, probe.world.width * 0.62);
  const y = probe.world.y + Math.max(16, probe.world.height * 0.55);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

function geometryChanged(
  before: Awaited<ReturnType<typeof createdProbe>>,
  after: Awaited<ReturnType<typeof createdProbe>>,
): boolean {
  if (!before || !after) return false;
  return (
    Math.abs(after.world.width - before.world.width) > 2
    || Math.abs(after.world.height - before.world.height) > 2
    || Math.abs(after.world.x - before.world.x) > 2
    || Math.abs(after.world.y - before.world.y) > 2
  );
}

async function dragHandle(page: Page, handle: string, dx: number, dy: number): Promise<boolean> {
  await dismissJumpMenu(page);
  const box = await getTransformHandleRect(page, handle);
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 4 });
  await page.mouse.up();
  return true;
}

test("created elements keep resizing without move on LinkedIn", async ({ page, context }) => {
  test.setTimeout(420_000);
  await requireLinkedInAuth(page);
  await clearPageOperations(context, page);
  await page.reload({ waitUntil: "domcontentloaded" });
  const filters = await linkedInFilters(page);
  await enableEdit(context, page);
  await dismissJumpMenu(page);
  const mentions = await filters.Mentions.boundingBox();
  expect(mentions).not.toBeNull();
  if (!mentions) return;

  const scores: Record<string, { repeated: number; moveResize: number; failures: number }> = {};
  const placeX = mentions.x + 48;
  const placeY = mentions.y + 210;

  for (const kind of RESIZE_KINDS) {
    await dismissJumpMenu(page);
    await addKind(page, kind, placeX, placeY);
    const elementId = await markCreatedRoot(page, kind);
    expect(elementId).toBeTruthy();
    await expect.poll(() => getTransformHandleRect(page, "resize-se")).not.toBeNull();
    let failures = 0;
    for (let index = 0; index < 20; index += 1) {
      const step = mixedHandle(index);
      const before = await createdProbe(page, kind);
      const outlineBefore = await getOverlayRect(page);
      const handled = await dragHandle(page, step.handle, step.dx, step.dy);
      const after = await createdProbe(page, kind);
      const outlineAfter = await getOverlayRect(page);
      const changed = geometryChanged(before, after);
      const sameRoot = after?.probe === "stable-root" && after.isConnected && after.elementId === elementId;
      if (!handled || !changed || !sameRoot) {
        failures += 1;
        expect.soft(
          { kind, index, handled, changed, sameRoot, before, after, outlineBefore, outlineAfter, step },
          `${kind} resize ${String(index + 1)} must keep working`,
        ).toEqual({ kind, index, handled: true, changed: true, sameRoot: true, before, after, outlineBefore, outlineAfter, step });
        break;
      }
    }
    await dismissJumpMenu(page);
    await selectCreated(page, kind);
    await page.keyboard.press("Control+Shift+]");
    const movedFrom = await createdProbe(page, kind);
    await page.keyboard.press("t");
    const target = page.locator(`[data-otf-component-kind="${kind}"]:not([data-otf-preview])`).last();
    await target.dragTo(target, { force: true, sourcePosition: { x: 18, y: 10 }, targetPosition: { x: 54, y: 28 } });
    await page.keyboard.press("t");
    await selectCreated(page, kind);
    const movedTo = await createdProbe(page, kind);
    if (!geometryChanged(movedFrom, movedTo)) {
      await dragCreated(page, kind, 48, 24);
      await selectCreated(page, kind);
    }
    const movedFinal = await createdProbe(page, kind);
    if (kind !== "search") {
      expect(geometryChanged(movedFrom, movedFinal), `${kind} must move before resize-after-move ${JSON.stringify({ movedFrom, movedFinal })}`).toBe(true);
    }
    await expect.poll(() => getTransformHandleRect(page, "resize-se")).not.toBeNull();
    let moveResize = 0;
    for (let pass = 0; pass < 2; pass += 1) {
      await selectCreated(page, kind);
      for (let index = 0; index < 5; index += 1) {
        const step = mixedHandle(index);
        const before = await createdProbe(page, kind);
        const handled = await dragHandle(page, step.handle, step.dx, step.dy);
        const after = await createdProbe(page, kind);
        const changed = geometryChanged(before, after);
        if (!handled || !changed || after?.probe !== "stable-root") {
          failures += 1;
          expect.soft({
            kind, pass, index, handled, changed, probe: after?.probe, before, after, step,
            outline: await getOverlayRect(page),
          }, `${kind} resize after move ${String(pass)}:${String(index)}`).toEqual({
            kind, pass, index, handled: true, changed: true, probe: "stable-root", before, after, step,
            outline: await getOverlayRect(page),
          });
          break;
        }
        moveResize += 1;
      }
      await dragCreated(page, kind, 12, 8);
      await selectCreated(page, kind);
      await expect.poll(() => getTransformHandleRect(page, "resize-se")).not.toBeNull();
    }
    scores[kind] = { repeated: 20 - Math.min(20, failures), moveResize, failures };
    const park = await createdProbe(page, kind);
    if (park) {
      await dragCreated(
        page,
        kind,
        56 - park.world.x,
        88 + RESIZE_KINDS.indexOf(kind) * 52 - park.world.y,
      );
    }
  }

  const rectangle = page.locator("[data-otf-component-kind='rectangle']").last();
  await rectangle.click({ force: true, position: { x: 8, y: 8 } });
  expect(await dragHandle(page, "resize-se", 8, 6)).toBe(true);
  await invokeChrome(page, "otf-save-button");
  await page.evaluate(() => new Promise<void>((resolve) => { window.setTimeout(resolve, 400); }));
  const beforeReload = await createdProbe(page, "rectangle");
  await reloadLinkedInAndReplay(page, context);
  await expect.poll(() => createdCount(page, "rectangle")).toBeGreaterThan(0);
  const afterReload = await createdProbe(page, "rectangle");
  expect(Math.abs((afterReload?.world.width ?? 0) - (beforeReload?.world.width ?? 0))).toBeLessThan(12);
  await page.locator("[data-otf-component-kind='rectangle']").last().click({ force: true, position: { x: 8, y: 8 } });
  await expect.poll(() => getTransformHandleRect(page, "resize-se")).not.toBeNull();
  const reloadBefore = await createdProbe(page, "rectangle");
  expect(await dragHandle(page, "resize-se", 10, 8)).toBe(true);
  const reloadAfter = await createdProbe(page, "rectangle");
  expect(Math.abs((reloadAfter?.world.width ?? 0) - (reloadBefore?.world.width ?? 0))).toBeGreaterThan(2);

  const totalFailures = Object.values(scores).reduce((sum, score) => sum + score.failures, 0);
  expect(totalFailures, JSON.stringify(scores)).toBe(0);
});
