import { getOverlayRect } from "../e2e/helpers/geometry.js";
import { enableEditMode } from "../e2e/helpers/actions.js";
import { readRuntimeDiagnostics, settleVisual } from "../e2e/helpers/runtime-state.js";
import {
  applyMutation,
  createFromPalette,
  deleteSelection,
  duplicateSelection,
  expect,
  fx,
  layerSelection,
  reloadAndReplay,
  saveNonEmpty,
  selectTarget,
  moveSelection,
  resizeSelection,
  rotateSelection,
  startCase,
  styleSelection,
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

  test("an original tombstone cannot resolve onto either of two moved clones", async ({ context, page }) => {
    await startCase(context, page, "DEEP-TOMBSTONE-TWO-CLONES");
    const originalMentions = fx(page, "pill-delta");

    await selectTarget(page, originalMentions, "select original mentions for clone one");
    const cloneOne = await duplicateSelection(page, "duplicate mentions once");
    await moveSelection(page, 90, 45, "move mentions clone one", cloneOne.locator);

    await selectTarget(page, originalMentions, "reselect original mentions for clone two");
    const cloneTwo = await duplicateSelection(page, "duplicate mentions twice");
    await moveSelection(page, 155, 78, "move mentions clone two", cloneTwo.locator);

    await selectTarget(page, originalMentions, "select original mentions for delete");
    await deleteSelection(page, originalMentions, "delete original mentions");
    await expect(originalMentions).not.toBeVisible();

    const myPosts = fx(page, "pill-gamma");
    await selectTarget(page, myPosts, "select original my posts");
    await moveSelection(page, 42, 30, "move original my posts", myPosts);
    await expect(myPosts, JSON.stringify(await readRuntimeDiagnostics(page))).toBeVisible();
    await expect(originalMentions).not.toBeVisible();
    await selectTarget(page, myPosts, "reselect moved original my posts");
    await resizeSelection(page, -36, -18, "resize original my posts", "resize-nw");

    await applyMutation(page, "rerender-row");
    await expect(originalMentions).not.toBeVisible();
    await expect(page.locator(`[data-otf-clone-id="${cloneOne.cloneId}"]`)).toBeVisible();
    await expect(page.locator(`[data-otf-clone-id="${cloneTwo.cloneId}"]`)).toBeVisible();

    const diagnostics = await readRuntimeDiagnostics(page);
    expect(
      diagnostics?.active.some((operation) => operation.type === "hide" && operation.text?.toLowerCase().includes("delta")),
      JSON.stringify(diagnostics),
    ).toBe(true);

    const liveMyPosts = fx(page, "pill-gamma");
    await selectTarget(page, liveMyPosts, "select my posts for delete");
    await deleteSelection(page, liveMyPosts, "delete my posts");
    await expect(liveMyPosts).not.toBeVisible();
    await expect(fx(page, "pill-delta")).not.toBeVisible();

    await saveNonEmpty(context, page, "save both source tombstones");
    const liveCloneOne = page.locator(`[data-otf-clone-id="${cloneOne.cloneId}"]`);
    await selectTarget(page, liveCloneOne, "select surviving clone before second save");
    await moveSelection(page, -24, 16, "edit surviving clone before second save", liveCloneOne);
    await saveNonEmpty(context, page, "save unrelated clone edit");

    await reloadAndReplay(page);
    await enableEditMode(context, page);
    await expect(fx(page, "pill-delta")).not.toBeVisible();
    await expect(fx(page, "pill-gamma")).not.toBeVisible();
    const replayedCloneOne = page.locator(`[data-otf-clone-id="${cloneOne.cloneId}"]`);
    const replayedCloneTwo = page.locator(`[data-otf-clone-id="${cloneTwo.cloneId}"]`);
    await expect(replayedCloneOne).toBeVisible();
    await expect(replayedCloneTwo).toBeVisible();
    await selectTarget(page, replayedCloneTwo, "select surviving clone after reload");
    await moveSelection(page, 20, -14, "edit surviving clone after reload", replayedCloneTwo);
    await expect(fx(page, "pill-delta")).not.toBeVisible();
    await expect(fx(page, "pill-gamma")).not.toBeVisible();
  });

  test("host tombstones dominate 75 saves and 100 unrelated UI operations", async ({ context, page }) => {
    test.setTimeout(600_000);
    await startCase(context, page, "DEEP-TOMBSTONE-SAVE-STRESS");

    const sourceA = fx(page, "pill-delta");
    await selectTarget(page, sourceA, "select source A for first clone");
    const cloneA = await duplicateSelection(page, "duplicate source A once");
    await moveSelection(page, 90, 45, "move clone A", cloneA.locator);
    await selectTarget(page, sourceA, "select source A for second clone");
    const cloneB = await duplicateSelection(page, "duplicate source A twice");
    await moveSelection(page, 155, 78, "move clone B", cloneB.locator);
    await selectTarget(page, sourceA, "delete source A");
    await deleteSelection(page, sourceA, "delete source A");

    const sourceB = fx(page, "pill-gamma");
    await selectTarget(page, sourceB, "delete source B");
    await deleteSelection(page, sourceB, "delete source B");

    const hostC = fx(page, "card-one");
    await selectTarget(page, hostC, "move host C");
    await moveSelection(page, 24, 14, "move host C", hostC);
    await selectTarget(page, hostC, "resize host C");
    await resizeSelection(page, -20, -12, "resize host C", "resize-nw");
    const created = await createFromPalette(page, "rectangle", 1040, 220, "create stress object");

    const saveDepths = new Set([1, 5, 10, 20, 30, 40, 50, 60, 75]);
    let expectedHidePaths: string[] | null = null;
    const assertState = async (label: string): Promise<void> => {
      await expect(fx(page, "pill-delta"), label).not.toBeVisible();
      await expect(fx(page, "pill-gamma"), label).not.toBeVisible();
      await expect(page.locator(`[data-otf-clone-id="${cloneA.cloneId}"]`), label).toBeVisible();
      await expect(page.locator(`[data-otf-clone-id="${cloneB.cloneId}"]`), label).toBeVisible();
      await expect(page.locator(`[data-otf-element-id="${created.elementId}"]`), label).toBeVisible();
      const diagnostics = await readRuntimeDiagnostics(page);
      const hidePaths = (diagnostics?.active ?? [])
        .filter((operation) => operation.type === "hide")
        .map((operation) => operation.cssPath)
        .filter((path): path is string => path !== null)
        .sort();
      expect(hidePaths, `${label}: ${JSON.stringify(diagnostics)}`).toHaveLength(2);
      expectedHidePaths ??= hidePaths;
      expect(hidePaths, label).toEqual(expectedHidePaths);
    };

    await assertState("initial stress state");
    for (let index = 1; index <= 100; index += 1) {
      const step = String(index);
      const liveCloneA = page.locator(`[data-otf-clone-id="${cloneA.cloneId}"]`);
      const liveCloneB = page.locator(`[data-otf-clone-id="${cloneB.cloneId}"]`);
      const liveCreated = page.locator(`[data-otf-element-id="${created.elementId}"]`);
      const liveHostC = fx(page, "card-one");
      switch (index % 6) {
        case 0:
          await selectTarget(page, liveCloneA, `stress ${step} clone A`);
          await moveSelection(page, index % 12 === 0 ? -12 : 12, index % 12 === 0 ? -8 : 8, `stress ${step} move clone A`, liveCloneA);
          break;
        case 1:
          await selectTarget(page, liveCloneB, `stress ${step} clone B`);
          await layerSelection(page, index % 2 === 0 ? "front" : "back");
          break;
        case 2:
          await selectTarget(page, liveCreated, `stress ${step} created`);
          await rotateSelection(page, 24, index % 4 === 0 ? 14 : -14, `stress ${step} rotate created`, liveCreated);
          break;
        case 3:
          await selectTarget(page, liveHostC, `stress ${step} host C style`);
          await styleSelection(page, index % 12 === 3 ? "0.72" : "0.88");
          break;
        case 4:
          await selectTarget(page, liveHostC, `stress ${step} host C move`);
          await moveSelection(page, index % 12 === 4 ? -10 : 10, index % 12 === 4 ? -7 : 7, `stress ${step} move host C`, liveHostC);
          break;
        default:
          await selectTarget(page, liveCloneB, `stress ${step} clone B move`);
          await moveSelection(page, index % 12 === 5 ? -11 : 11, index % 12 === 5 ? -7 : 7, `stress ${step} move clone B`, liveCloneB);
      }

      if (index <= 75) await saveNonEmpty(context, page, `deep save ${step}`);
      if (saveDepths.has(index)) await assertState(`save depth ${step}`);
      if ([25, 50, 75, 100].includes(index)) {
        await reloadAndReplay(page);
        await enableEditMode(context, page);
        await assertState(`reload after operation ${step}`);
      } else {
        await assertState(`live operation ${step}`);
      }
    }
  });
});
