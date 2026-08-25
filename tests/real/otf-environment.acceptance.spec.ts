import { getTransformHandleRect } from "../e2e/helpers/geometry.js";
import { clearPageOperations, dragRealTarget, enableEdit, expect, productFailure, saveReal, selectRealTarget, settleVisual, test } from "./harness.js";
import { linkedInFilters, reloadLinkedInAndReplay, requireLinkedInAuth } from "./linkedin.js";
import { env, envValue, requireExecute } from "./otf-env.js";
import { resizeRectFromCorner } from "../../src/runtime-v2/editor-parity-geometry.js";
import { unionRects } from "../../src/runtime-v2/runtime-selection.js";

type Box = { x: number; y: number; width: number; height: number; rotation?: number };

async function geometry(page: Parameters<typeof env>[0], id: string): Promise<Box> {
  return envValue(await env(page, "getGeometry", id), `geometry ${id}`) as Box;
}

async function expectSave(page: Parameters<typeof env>[0]): Promise<void> {
  await saveReal(page);
  const host = page.locator("#on-the-fly-root-host");
  await expect.poll(async () => host.getAttribute("data-otf-save-status")).not.toBe("saving");
  const status = await host.getAttribute("data-otf-save-status");
  expect(status === "failed" ? `SAVE FAILED ${await host.getAttribute("data-otf-save-error") ?? ""}` : status).toMatch(/^(saved|idle)$/u);
}

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
    const pageObservation = observed.value as { url: string; viewport: { width: number }; elements: Array<{ id: string }> };
    expect(pageObservation.url).toContain("linkedin.com");
    expect(pageObservation.viewport.width).toBeGreaterThan(0);
    expect(pageObservation.elements.some((element) => element.id.startsWith("otf"))).toBe(true);

    let found = await env(page, "findElements", { text: "Mentions", role: "radio", visibleOnly: true });
    if (!found.ok || !(found.value as string[]).length) {
      found = await env(page, "findElements", { text: "Mentions", visibleOnly: true });
    }
    expect(found.ok).toBe(true);
    const mentionId = (found.value as string[])[0];
    expect(mentionId, productFailure("find Mentions returned no ElementId")).toBeTruthy();
    if (!mentionId) return;
    const inspected = await env(page, "inspectElement", mentionId);
    expect(inspected.ok).toBe(true);
    const before = (inspected.value as { geometry: Box; origin: string }).geometry;
    expect((inspected.value as { origin: string }).origin).toBe("host");

    const styled = await env(page, "execute", { type: "style", target: mentionId, property: "backgroundColor", value: "rgb(255, 0, 0)" });
    expect(styled.ok, productFailure(`env STYLE failed: ${styled.error?.message ?? "unknown"}`)).toBe(true);
    const checkpoint = await env(page, "checkpoint", "before-env");
    expect(checkpoint.ok).toBe(true);
    const moved = await env(page, "execute", { type: "move", target: mentionId, delta: { x: 36, y: 12 } });
    expect(moved.ok, productFailure(`env MOVE failed: ${moved.error?.message ?? "unknown"}`)).toBe(true);
    const afterMove = await geometry(page, mentionId);
    expect(afterMove.x - before.x).toBeGreaterThan(20);
    expect(afterMove.y - before.y).toBeGreaterThan(4);
    const resized = await env(page, "execute", {
      type: "resize",
      targets: [mentionId],
      toBounds: { x: before.x, y: before.y, width: Math.max(40, before.width + 24), height: Math.max(20, before.height + 10) },
    });
    expect(resized.ok, productFailure(`env RESIZE failed: ${resized.error?.message ?? "unknown"}`)).toBe(true);
    const layered = await env(page, "execute", { type: "layer", target: mentionId, command: "forward" });
    expect(layered.ok, productFailure(`env LAYER failed: ${layered.error?.message ?? "unknown"}`)).toBe(true);

    const created = requireExecute(await env(page, "execute", { type: "create", kind: "button", rect: { x: 80, y: 80, width: 120, height: 40 } }), "env CREATE");
    const createdId = created.target;
    expect(createdId).toBeTruthy();
    if (!createdId) return;
    expect(((await env(page, "inspectElement", createdId)).value as { origin: string }).origin).toBe("created");
    const rotated = await env(page, "execute", { type: "rotate", targets: [createdId], degrees: 15 });
    expect(rotated.ok, productFailure(`env ROTATE failed: ${rotated.error?.message ?? "unknown"}`)).toBe(true);
    const edited = await env(page, "execute", { type: "text", target: createdId, value: "Env Button" });
    expect(edited.ok, productFailure(`env TEXT failed: ${edited.error?.message ?? "unknown"}`)).toBe(true);
    const deleted = await env(page, "execute", { type: "delete", target: createdId });
    expect(deleted.ok, productFailure(`env DELETE failed: ${deleted.error?.message ?? "unknown"}`)).toBe(true);

    const rolled = await env(page, "rollback", checkpoint.value);
    expect(rolled.ok, productFailure(`rollback failed: ${rolled.error?.message ?? "unknown"}`)).toBe(true);
    const restored = await geometry(page, mentionId);
    expect(Math.abs(restored.x - before.x)).toBeLessThan(8);
    const continueMove = await env(page, "execute", { type: "move", target: mentionId, delta: { x: 16, y: 0 } });
    expect(continueMove.ok, productFailure("continue editing after rollback failed")).toBe(true);
    expect((await env(page, "rollback", checkpoint.value)).ok).toBe(true);
  });

  test("host multi-target, human transform, and save-reload stay on one ledger", async ({ page, context }) => {
    const filters = await linkedInFilters(page);
    await selectRealTarget(page, filters.Mentions);
    await page.keyboard.down("Shift");
    await selectRealTarget(page, filters["My posts"]);
    await selectRealTarget(page, filters.Jobs);
    await page.keyboard.up("Shift");
    const ids = (envValue(await env(page, "observe", { scope: "selection" }), "selection") as { selection: string[] }).selection;
    expect(ids.length, productFailure(`expected 3 selected hosts, got ${String(ids.length)}`)).toBeGreaterThanOrEqual(3);
    const start = await Promise.all(ids.map((id) => geometry(page, id)));
    const fromBounds = unionRects(start.map((box) => ({ x: box.x, y: box.y, width: box.width, height: box.height })));
    expect(fromBounds, productFailure("missing host union")).not.toBeNull();
    if (!fromBounds) return;

    requireExecute(await env(page, "execute", {
      type: "resize",
      targets: ids,
      fromBounds,
      toBounds: resizeRectFromCorner(fromBounds, "se", 40, 16),
    }), "env multi-resize");
    const resized = await geometry(page, ids[0] ?? "");
    expect(resized.width + resized.height).toBeGreaterThan((start[0]?.width ?? 0) + (start[0]?.height ?? 0));
    await page.keyboard.press("Control+z");
    await settleVisual(page);

    requireExecute(await env(page, "execute", { type: "rotate", targets: ids, degrees: 15 }), "env multi-rotate");
    const rotated = await geometry(page, ids[0] ?? "");
    expect(Math.abs((rotated.rotation ?? 0) - 15)).toBeLessThan(1);
    await page.keyboard.press("Control+z");
    await settleVisual(page);

    const mentionId = ids[0];
    expect(mentionId).toBeTruthy();
    if (!mentionId) return;
    const created = requireExecute(await env(page, "execute", { type: "create", kind: "rectangle", rect: { x: 80, y: 140, width: 110, height: 48 } }), "persist create");
    const persistId = created.target;
    expect(persistId).toBeTruthy();
    if (!persistId) return;
    const createdEl = page.locator(`[data-otf-element-id="${persistId}"]`).first();
    await selectRealTarget(page, createdEl);
    await dragRealTarget(page, createdEl, 12, 8);
    const handle = await getTransformHandleRect(page, "resize-se");
    expect(handle, productFailure("missing resize handle")).not.toBeNull();
    if (!handle) return;
    await page.mouse.move(handle.x + 5, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 25, handle.y + 17, { steps: 6 });
    await page.mouse.up();
    await settleVisual(page);
    requireExecute(await env(page, "execute", { type: "move", target: mentionId, delta: { x: 20, y: 8 } }), "env MOVE");

    const beforeSave = envValue(await env(page, "getChanges"), "changes") as unknown[];
    expect(beforeSave.length).toBeGreaterThan(0);
    await expectSave(page);
    await reloadLinkedInAndReplay(page, context);
    expect((await env(page, "inspectElement", persistId)).ok, productFailure("created element lost after save/reload")).toBe(true);
    const afterReload = envValue(await env(page, "getChanges"), "reload changes") as unknown[];
    expect(afterReload.length, productFailure("history diverged after save/reload")).toBe(beforeSave.length);
  });
});
