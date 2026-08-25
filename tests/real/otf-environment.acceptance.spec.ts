import { getTransformHandleRect, rect } from "../e2e/helpers/geometry.js";
import { clearPageOperations, dragRealTarget, enableEdit, expect, nearRect, productFailure, saveReal, selectRealTarget, settleVisual, test } from "./harness.js";
import { linkedInFilters, reloadLinkedInAndReplay, requireLinkedInAuth } from "./linkedin.js";
import { env, envValue, requireExecute } from "./otf-env.js";
import { planMultiTargetRotate, resizeRectFromCorner } from "../../src/runtime-v2/editor-parity-geometry.js";
import { unionRects } from "../../src/runtime-v2/runtime-selection.js";

test.describe("OTFEnvironment LinkedIn contract", () => {
  test.beforeEach(async ({ page, context }) => {
    await requireLinkedInAuth(page);
    await clearPageOperations(context, page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await linkedInFilters(page);
    await enableEdit(context, page);
  });

  test("observe, find, execute, and rollback share the live runtime", async ({ page }) => {
    const observed = await env(page, "observe", { scope: "viewport" });
    expect(observed.ok, productFailure(`observe failed: ${observed.error?.message ?? "unknown"}`)).toBe(true);
    const pageObservation = observed.value as { url: string; viewport: { width: number }; selection: string[]; elements: Array<{ id: string }>; revision: number };
    expect(pageObservation.url).toContain("linkedin.com");
    expect(pageObservation.viewport.width).toBeGreaterThan(0);
    expect(pageObservation.elements.some((element) => element.id.startsWith("otf"))).toBe(true);

    let found = await env(page, "findElements", { text: "Mentions", role: "radio", visibleOnly: true });
    if (!found.ok || !(found.value as string[]).length) {
      found = await env(page, "findElements", { text: "Mentions", visibleOnly: true });
    }
    expect(found.ok).toBe(true);
    const mentionIds = found.value as string[];
    expect(mentionIds.length, productFailure("find Mentions returned no ElementId")).toBeGreaterThan(0);
    const mentionId = mentionIds[0];
    expect(mentionId).toBeTruthy();
    if (!mentionId) return;
    const inspected = await env(page, "inspectElement", mentionId);
    expect(inspected.ok).toBe(true);
    const before = (inspected.value as { geometry: { x: number; y: number; width: number; height: number }; origin: string }).geometry;
    expect((inspected.value as { origin: string }).origin).toBe("host");

    const styled = await env(page, "execute", { type: "style", target: mentionId, property: "backgroundColor", value: "rgb(255, 0, 0)" });
    expect(styled.ok, productFailure(`env STYLE failed: ${styled.error?.message ?? "unknown"}`)).toBe(true);

    const checkpoint = await env(page, "checkpoint", "before-env");
    expect(checkpoint.ok).toBe(true);
    const moved = await env(page, "execute", { type: "move", target: mentionId, delta: { x: 36, y: 12 } });
    expect(moved.ok, productFailure(`env MOVE failed: ${moved.error?.message ?? "unknown"}`)).toBe(true);
    const afterMove = await env(page, "getGeometry", mentionId);
    const after = afterMove.value as { x: number; y: number };
    expect(after.x - before.x).toBeGreaterThan(20);
    expect(after.y - before.y).toBeGreaterThan(4);

    const resized = await env(page, "execute", {
      type: "resize",
      targets: [mentionId],
      toBounds: { x: before.x, y: before.y, width: Math.max(40, before.width + 24), height: Math.max(20, before.height + 10) },
    });
    expect(resized.ok, productFailure(`env RESIZE failed: ${resized.error?.message ?? "unknown"}`)).toBe(true);
    const layered = await env(page, "execute", { type: "layer", target: mentionId, command: "forward" });
    expect(layered.ok, productFailure(`env LAYER failed: ${layered.error?.message ?? "unknown"}`)).toBe(true);

    const created = await env(page, "execute", { type: "create", kind: "button", rect: { x: 80, y: 80, width: 120, height: 40 } });
    expect(created.ok, productFailure(`env CREATE failed: ${created.error?.message ?? "unknown"}`)).toBe(true);
    const createdId = (created.value as { target?: string }).target;
    expect(createdId).toBeTruthy();
    if (!createdId) return;
    const createdInspect = await env(page, "inspectElement", createdId);
    expect((createdInspect.value as { origin: string }).origin).toBe("created");
    const rotated = await env(page, "execute", { type: "rotate", targets: [createdId], degrees: 15 });
    expect(rotated.ok, productFailure(`env ROTATE failed: ${rotated.error?.message ?? "unknown"}`)).toBe(true);
    const edited = await env(page, "execute", { type: "text", target: createdId, value: "Env Button" });
    expect(edited.ok, productFailure(`env TEXT failed: ${edited.error?.message ?? "unknown"}`)).toBe(true);

    const deleted = await env(page, "execute", { type: "delete", target: createdId });
    expect(deleted.ok, productFailure(`env DELETE failed: ${deleted.error?.message ?? "unknown"}`)).toBe(true);

    const rolled = await env(page, "rollback", checkpoint.value);
    expect(rolled.ok, productFailure(`rollback failed: ${rolled.error?.message ?? "unknown"}`)).toBe(true);
    const restored = await env(page, "getGeometry", mentionId);
    const restoredBox = restored.value as { x: number; y: number };
    expect(Math.abs(restoredBox.x - before.x)).toBeLessThan(8);

    const continueMove = await env(page, "execute", { type: "move", target: mentionId, delta: { x: 16, y: 0 } });
    expect(continueMove.ok, productFailure("continue editing after rollback failed")).toBe(true);
    const undo = await env(page, "rollback", checkpoint.value);
    expect(undo.ok).toBe(true);
  });

  test("multi-target resize and rotate match the human union primitive", async ({ page }) => {
    test.setTimeout(240_000);
    const filters = await linkedInFilters(page);
    const members = [filters.Mentions, filters["My posts"], filters.Jobs];
    await selectRealTarget(page, filters.Mentions);
    await page.keyboard.down("Shift");
    await selectRealTarget(page, filters["My posts"]);
    await selectRealTarget(page, filters.Jobs);
    await page.keyboard.up("Shift");
    const selected = envValue(await env(page, "observe", { scope: "selection" }), "observe selection") as { selection: string[] };
    expect(selected.selection.length, productFailure(`expected 3 selected targets, got ${String(selected.selection.length)}`)).toBeGreaterThanOrEqual(3);
    const start = await Promise.all(members.map((member) => rect(member)));
    const targets: string[] = [];
    for (const origin of start) {
      let best: { id: string; dist: number } | null = null;
      for (const id of selected.selection) {
        const box = envValue(await env(page, "getGeometry", id), `geometry ${id}`) as { x: number; y: number; width: number; height: number };
        const dist = Math.abs(box.x - origin.x) + Math.abs(box.y - origin.y) + Math.abs(box.width - origin.width) + Math.abs(box.height - origin.height);
        if (!best || dist < best.dist) best = { id, dist };
      }
      expect(best, productFailure("could not bind member to ElementId")).not.toBeNull();
      expect(best?.dist, productFailure(`ElementId did not match member geometry ${JSON.stringify(origin)}`)).toBeLessThan(12);
      if (best) targets.push(best.id);
    }
    const startBoxes: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const id of targets) {
      const box = envValue(await env(page, "getGeometry", id), `start ${id}`) as { x: number; y: number; width: number; height: number };
      startBoxes.push({ x: box.x, y: box.y, width: box.width, height: box.height });
    }
    const fromBounds = unionRects(startBoxes);
    expect(fromBounds, productFailure("missing start union")).not.toBeNull();
    if (!fromBounds) return;

    const handle = await getTransformHandleRect(page, "resize-se");
    expect(handle, productFailure("missing resize handle for multi-select")).not.toBeNull();
    if (!handle) return;
    const pointerDx = 51;
    const pointerDy = 23;
    await page.mouse.move(handle.x + 5, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 5 + pointerDx, handle.y + 5 + pointerDy, { steps: 8 });
    await page.mouse.up();
    await settleVisual(page);
    const humanResize: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const id of targets) {
      humanResize.push(envValue(await env(page, "getGeometry", id), `human resize ${id}`) as { x: number; y: number; width: number; height: number });
    }
    const toBounds = resizeRectFromCorner(fromBounds, "se", pointerDx, pointerDy);
    await page.keyboard.press("Control+z");
    await settleVisual(page);
    for (const [index, member] of members.entries()) {
      const origin = start[index];
      if (!origin) continue;
      expect(nearRect(await rect(member), origin, 8), productFailure(`human resize undo failed for member ${String(index)}`)).toBe(true);
    }
    await page.keyboard.press("Escape");
    const envResize = await env(page, "execute", {
      type: "resize",
      targets,
      fromBounds,
      toBounds,
    });
    expect(envResize.ok, productFailure(`env multi-resize failed: ${envResize.error?.message ?? JSON.stringify(envResize.value)}`)).toBe(true);
    expect((envResize.value as { ok?: boolean }).ok).not.toBe(false);
    for (const [index, id] of targets.entries()) {
      const expected = humanResize[index];
      if (!expected) continue;
      const actual = envValue(await env(page, "getGeometry", id), `env resize ${id}`) as { x: number; y: number; width: number; height: number };
      expect(
        nearRect({ ...actual, top: actual.y, left: actual.x, right: actual.x + actual.width, bottom: actual.y + actual.height }, { ...expected, top: expected.y, left: expected.x, right: expected.x + expected.width, bottom: expected.y + expected.height }, 8),
        productFailure(`multi-target resize parity failed for member ${String(index)} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`),
      ).toBe(true);
    }
    await page.keyboard.press("Control+z");
    await settleVisual(page);

    await selectRealTarget(page, filters.Mentions);
    await page.keyboard.down("Shift");
    await selectRealTarget(page, filters["My posts"]);
    await selectRealTarget(page, filters.Jobs);
    await page.keyboard.up("Shift");
    const rotateStart: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const id of targets) {
      const box = envValue(await env(page, "getGeometry", id), `rotate start ${id}`) as { x: number; y: number; width: number; height: number };
      rotateStart.push({ x: box.x, y: box.y, width: box.width, height: box.height });
    }
    await page.keyboard.press("Escape");
    const rotateUnion = unionRects(rotateStart);
    expect(rotateUnion, productFailure("missing rotate union")).not.toBeNull();
    if (!rotateUnion) return;
    const degrees = 15;
    const plannedRotate = planMultiTargetRotate(rotateStart, rotateUnion, degrees);
    const envRotate = await env(page, "execute", { type: "rotate", targets, degrees });
    expect(envRotate.ok, productFailure(`env multi-rotate failed: ${envRotate.error?.message ?? JSON.stringify(envRotate.value)}`)).toBe(true);
    expect((envRotate.value as { ok?: boolean }).ok !== false, productFailure(`env multi-rotate result: ${JSON.stringify(envRotate.value)}`)).toBe(true);
    for (const [index, id] of targets.entries()) {
      const expected = plannedRotate[index];
      if (!expected) continue;
      const actual = envValue(await env(page, "getGeometry", id), `env rotate ${id}`) as { x: number; y: number; width: number; height: number; rotation: number };
      const actualCenter = { x: actual.x + actual.width / 2, y: actual.y + actual.height / 2 };
      const expectedCenter = { x: expected.x + expected.width / 2, y: expected.y + expected.height / 2 };
      expect(Math.hypot(actualCenter.x - expectedCenter.x, actualCenter.y - expectedCenter.y), productFailure(`multi-target rotate center mismatch member ${String(index)} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`)).toBeLessThan(8);
      expect(Math.abs(actual.rotation - degrees), productFailure(`rotation delta mismatch member ${String(index)} got ${String(actual.rotation)}`)).toBeLessThan(1);
    }
    await page.keyboard.press("Control+z");
    await settleVisual(page);

    const created = requireExecute(await env(page, "execute", { type: "create", kind: "rectangle", rect: { x: 64, y: 160, width: 90, height: 40 } }), "mixed create");
    const createdId = created.target;
    const hostId = targets[0];
    expect(createdId && hostId, productFailure("mixed targets missing")).toBeTruthy();
    if (!createdId || !hostId) return;
    const hostBox = envValue(await env(page, "getGeometry", hostId), "mix host") as { x: number; y: number; width: number; height: number };
    const createdBox = envValue(await env(page, "getGeometry", createdId), "mix created") as { x: number; y: number; width: number; height: number };
    const mixFrom = unionRects([
      { x: hostBox.x, y: hostBox.y, width: hostBox.width, height: hostBox.height },
      { x: createdBox.x, y: createdBox.y, width: createdBox.width, height: createdBox.height },
    ]);
    expect(mixFrom, productFailure("mixed union missing")).not.toBeNull();
    if (!mixFrom) return;
    const mixResize = await env(page, "execute", { type: "resize", targets: [hostId, createdId], fromBounds: mixFrom, toBounds: resizeRectFromCorner(mixFrom, "se", 20, 10) });
    expect(mixResize.ok && (mixResize.value as { ok?: boolean }).ok !== false, productFailure(`mixed resize: ${mixResize.error?.message ?? JSON.stringify(mixResize.value)}`)).toBe(true);
    await page.keyboard.press("Control+z");
    const mixRotate = await env(page, "execute", { type: "rotate", targets: [hostId, createdId], degrees: 12 });
    expect(mixRotate.ok && (mixRotate.value as { ok?: boolean }).ok !== false, productFailure(`mixed rotate: ${mixRotate.error?.message ?? JSON.stringify(mixRotate.value)}`)).toBe(true);
  });

  test("compact 20/20 interleaved save-reload", async ({ page, context }) => {
    test.setTimeout(240_000);
    let filters = await linkedInFilters(page);
    await selectRealTarget(page, filters.Mentions);
    const mentionId = (envValue(await env(page, "observe", { scope: "selection" }), "compact mention") as { selection: string[] }).selection[0];
    expect(mentionId, productFailure("compact mention missing")).toBeTruthy();
    if (!mentionId) return;
    const created = requireExecute(await env(page, "execute", { type: "create", kind: "rectangle", rect: { x: 80, y: 140, width: 110, height: 48 } }), "compact create");
    const rectId = created.target;
    expect(rectId, productFailure("compact create missing id")).toBeTruthy();
    if (!rectId) return;
    const createdEl = () => page.locator(`[data-otf-element-id="${rectId}"]`).first();
    let humanOps = 0;
    let envOps = 0;
    let saves = 0;
    let reloads = 0;
    const persist = async (): Promise<void> => {
      await saveReal(page);
      const host = page.locator("#on-the-fly-root-host");
      await expect.poll(async () => host.getAttribute("data-otf-save-status")).not.toBe("saving");
      const status = await host.getAttribute("data-otf-save-status");
      expect(status === "failed" ? `SAVE FAILED ${await host.getAttribute("data-otf-save-error") ?? ""}` : status).toMatch(/^(saved|idle)$/u);
      saves += 1;
    };
    for (let index = 0; index < 20; index += 1) {
      await selectRealTarget(page, createdEl());
      await dragRealTarget(page, createdEl(), 6, 3);
      humanOps += 1;
      requireExecute(await env(page, "execute", { type: "move", target: rectId, delta: { x: 4, y: -2 } }), `compact env ${String(index)}`);
      envOps += 1;
      if (index % 4 === 3) await persist();
      if (index === 9 || index === 19) {
        await reloadLinkedInAndReplay(page, context);
        reloads += 1;
        filters = await linkedInFilters(page);
        expect((await env(page, "inspectElement", rectId)).ok, productFailure("created lost after compact reload")).toBe(true);
      }
    }
    expect(humanOps).toBeGreaterThanOrEqual(20);
    expect(envOps).toBeGreaterThanOrEqual(20);
    expect(saves).toBeGreaterThanOrEqual(5);
    expect(reloads).toBeGreaterThanOrEqual(2);
  });
});
