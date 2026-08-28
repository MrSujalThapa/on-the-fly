import { getOverlayRect } from "../e2e/helpers/geometry.js";
import { enableEditMode } from "../e2e/helpers/actions.js";
import { readRuntimeDiagnostics, settleVisual } from "../e2e/helpers/runtime-state.js";
import {
  applyMutation,
  deleteSelection,
  duplicateSelection,
  expect,
  fx,
  reloadAndReplay,
  saveNonEmpty,
  selectTarget,
  moveSelection,
  startCase,
  test,
} from "./harness.js";

test.describe("runtime v2 final-polish continuation", () => {
  test("a host delete tombstone survives rerender, save, and reload", async ({ context, page }) => {
    await startCase(context, page, "DELETE-TOMBSTONE-RERENDER");
    const target = fx(page, "pill-beta");
    await selectTarget(page, target, "delete host");
    await deleteSelection(page, target, "delete host");

    await applyMutation(page, "rerender-row");
    await expect(fx(page, "pill-beta")).not.toBeVisible();

    await saveNonEmpty(context, page, "save tombstone");
    await applyMutation(page, "add-sibling");
    await expect(fx(page, "pill-beta")).not.toBeVisible();

    await reloadAndReplay(page);
    await expect(fx(page, "pill-beta")).not.toBeVisible();
  });

  test("a duplicated container keeps meaningful descendants selectable", async ({ context, page }) => {
    await startCase(context, page, "CLONE-CONTAINER-DESCENDANTS");
    await selectTarget(page, fx(page, "pill-beta"), "select child");
    await page.keyboard.press("Alt+ArrowUp");
    const { locator: clone } = await duplicateSelection(page, "duplicate filter row");

    for (const name of ["pill-alpha", "pill-beta", "pill-gamma", "pill-delta"] as const) {
      const child = clone.locator(`[data-fx="${name}"]`);
      await selectTarget(page, child, `select cloned ${name}`);
      const [childBox, overlay] = await Promise.all([child.boundingBox(), getOverlayRect(page)]);
      expect(childBox).not.toBeNull();
      expect(overlay).not.toBeNull();
      expect(
        Math.abs((overlay?.width ?? 0) - (childBox?.width ?? 0)),
        JSON.stringify(await readRuntimeDiagnostics(page)),
      ).toBeLessThanOrEqual(8);
      expect(Math.abs((overlay?.height ?? 0) - (childBox?.height ?? 0))).toBeLessThanOrEqual(8);
    }

    const cloneBox = await clone.boundingBox();
    expect(cloneBox).not.toBeNull();
    if (cloneBox) {
      await page.mouse.click(cloneBox.x + 3, cloneBox.y + 3);
      await settleVisual(page);
      const overlay = await getOverlayRect(page);
      expect(Math.abs((overlay?.width ?? 0) - cloneBox.width)).toBeLessThanOrEqual(8);
      expect(Math.abs((overlay?.height ?? 0) - cloneBox.height)).toBeLessThanOrEqual(8);
    }

    await saveNonEmpty(context, page, "save cloned container");
    await reloadAndReplay(page);
    await enableEditMode(context, page);
    const replayedClone = page.locator("[data-otf-clone-id]").first();
    const replayedChild = replayedClone.locator('[data-fx="pill-gamma"]');
    await selectTarget(page, replayedChild, "select replayed clone child");
    const [childBox, overlay] = await Promise.all([replayedChild.boundingBox(), getOverlayRect(page)]);
    expect(Math.abs((overlay?.width ?? 0) - (childBox?.width ?? 0))).toBeLessThanOrEqual(8);
  });

  test("clone descendant edits and tombstones stay isolated through replay", async ({ context, page }) => {
    await startCase(context, page, "CLONE-DESCENDANT-IDENTITY-ISOLATION");
    await selectTarget(page, fx(page, "pill-beta"), "select source child");
    await page.keyboard.press("Alt+ArrowUp");
    const { cloneId, locator: clone } = await duplicateSelection(page, "duplicate filter row");

    const movedChild = clone.locator('[data-fx="pill-gamma"]');
    await selectTarget(page, movedChild, "select cloned gamma");
    const before = await movedChild.boundingBox();
    await moveSelection(page, 70, 35, "move cloned gamma", movedChild);
    const detachedMovedChild = page.locator('[data-fx="pill-gamma"][data-otf-detached="true"]');
    const moved = await detachedMovedChild.boundingBox();
    expect(Math.abs((moved?.x ?? 0) - (before?.x ?? 0))).toBeGreaterThan(40);

    const deletedChild = clone.locator('[data-fx="pill-beta"]');
    await selectTarget(page, deletedChild, "select cloned beta");
    await deleteSelection(page, deletedChild, "delete cloned beta");
    await expect(fx(page, "pill-beta")).toBeVisible();

    await saveNonEmpty(context, page, "save clone descendant state");
    await applyMutation(page, "rerender-row");
    await expect(fx(page, "pill-beta")).toBeVisible();

    await reloadAndReplay(page);
    await enableEditMode(context, page);
    const replayedClone = page.locator(`[data-otf-clone-id="${cloneId}"]`);
    await expect(replayedClone.locator('[data-fx="pill-beta"]')).not.toBeVisible();
    await expect(fx(page, "pill-beta")).toBeVisible();
    await selectTarget(
      page,
      page.locator('[data-fx="pill-gamma"][data-otf-detached="true"]'),
      "select replayed moved gamma",
    );
  });
});
