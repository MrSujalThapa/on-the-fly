import { getTransformHandleRect, rect } from "../e2e/helpers/geometry.js";
import { clearPageOperations, enableEdit, expect, nearRect, productFailure, selectRealTarget, settleVisual, test } from "./harness.js";
import { linkedInFilters, requireLinkedInAuth } from "./linkedin.js";
import { env, envValue } from "./otf-env.js";

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

    let handle = await getTransformHandleRect(page, "resize-se");
    expect(handle, productFailure("missing resize handle for multi-select")).not.toBeNull();
    if (!handle) return;
    await page.mouse.move(handle.x + 5, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 56, handle.y + 28, { steps: 8 });
    await page.mouse.up();
    await settleVisual(page);
    const humanResize: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const id of targets) {
      humanResize.push(envValue(await env(page, "getGeometry", id), `human resize ${id}`) as { x: number; y: number; width: number; height: number });
    }
    const minX = Math.min(...humanResize.map((box) => box.x));
    const minY = Math.min(...humanResize.map((box) => box.y));
    const toBounds = {
      x: minX,
      y: minY,
      width: Math.max(...humanResize.map((box) => box.x + box.width)) - minX,
      height: Math.max(...humanResize.map((box) => box.y + box.height)) - minY,
    };
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
    handle = await getTransformHandleRect(page, "rotate");
    expect(handle, productFailure("missing rotate handle for multi-select")).not.toBeNull();
    if (!handle) return;
    await page.mouse.move(handle.x + 5, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 40, handle.y + 8, { steps: 8 });
    await page.mouse.up();
    await settleVisual(page);
    const humanRotate: Array<{ x: number; y: number; width: number; height: number; rotation: number }> = [];
    for (const id of targets) {
      humanRotate.push(envValue(await env(page, "getGeometry", id), `human rotate ${id}`) as { x: number; y: number; width: number; height: number; rotation: number });
    }
    const degrees = humanRotate[0]?.rotation ?? 0;
    expect(Math.abs(degrees), productFailure("human rotate produced no rotation")).toBeGreaterThan(1);
    await page.keyboard.press("Control+z");
    await settleVisual(page);
    await page.keyboard.press("Escape");
    const envRotate = await env(page, "execute", { type: "rotate", targets, degrees });
    expect(envRotate.ok, productFailure(`env multi-rotate failed: ${envRotate.error?.message ?? JSON.stringify(envRotate.value)}`)).toBe(true);
    expect((envRotate.value as { ok?: boolean }).ok).not.toBe(false);
    for (const [index, id] of targets.entries()) {
      const expected = humanRotate[index];
      if (!expected) continue;
      const actual = envValue(await env(page, "getGeometry", id), `env rotate ${id}`) as { x: number; y: number; width: number; height: number; rotation: number };
      expect(
        nearRect({ ...actual, top: actual.y, left: actual.x, right: actual.x + actual.width, bottom: actual.y + actual.height }, { ...expected, top: expected.y, left: expected.x, right: expected.x + expected.width, bottom: expected.y + expected.height }, 8),
        productFailure(`multi-target rotate parity failed for member ${String(index)} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`),
      ).toBe(true);
      expect(Math.abs(actual.rotation - expected.rotation), productFailure(`rotation delta mismatch member ${String(index)}`)).toBeLessThan(1);
    }
    await page.keyboard.press("Control+z");
    await settleVisual(page);
  });
});
