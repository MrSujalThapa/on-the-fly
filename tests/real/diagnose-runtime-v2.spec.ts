import { getOverlayRect } from "../e2e/helpers/geometry.js";
import { armLassoFromToolbar, createKindFromToolbar } from "./chrome-ui.js";
import {
  attachFailureArtifacts,
  captureStepSnapshot,
  dragHandle,
} from "./oracles.js";
import {
  clearPageOperations,
  enableEdit,
  expect,
  productFailure,
  selectAndDragReal,
  selectRealTarget,
  settleVisual,
  test,
} from "./harness.js";
import { linkedInFilters, requireLinkedInAuth } from "./linkedin.js";

test.describe("Runtime V2 diagnosis on real LinkedIn", () => {
  test.beforeEach(async ({ page, context }) => {
    await requireLinkedInAuth(page);
    await clearPageOperations(context, page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await linkedInFilters(page);
    await enableEdit(context, page);
  });

  test("DIAG-01 Mentions ROTATE then MOVE +200 X stays world-axis", async ({ page }, testInfo) => {
    const filters = await linkedInFilters(page);
    await selectRealTarget(page, filters.Mentions);
    const beforeRotate = await captureStepSnapshot(page, filters.Mentions);
    const rotated = await dragHandle(page, "rotate", 70, 40);
    expect(rotated, productFailure("rotate handle missing")).toBe(true);
    await settleVisual(page);
    const afterRotate = await captureStepSnapshot(page, filters.Mentions);
    const rotate = Number(afterRotate.oracle.storedTransform?.rotate ?? 0);
    if (Math.abs(rotate) < 5) {
      await attachFailureArtifacts(page, testInfo, "DIAG-01", 1, beforeRotate, afterRotate);
      throw new Error(productFailure(`rotation did not stick rotate=${String(rotate)}`));
    }

    const beforeMove = afterRotate;
    const moved = await selectAndDragReal(page, filters.Mentions, 200, 0);
    await settleVisual(page);
    const afterMove = await captureStepSnapshot(page, filters.Mentions);
    const dx = afterMove.oracle.rect.x + afterMove.oracle.rect.width / 2 - (moved.before.x + moved.before.width / 2);
    const dy = afterMove.oracle.rect.y + afterMove.oracle.rect.height / 2 - (moved.before.y + moved.before.height / 2);
    if (afterMove.oracle.visibility === "hidden" || afterMove.oracle.display === "none" || afterMove.oracle.rect.width < 2) {
      await attachFailureArtifacts(page, testInfo, "DIAG-01", 2, beforeMove, afterMove);
      throw new Error(productFailure("element disappeared after rotate→move"));
    }
    if (Math.abs(dx - 200) > 40 || Math.abs(dy) > 40) {
      await attachFailureArtifacts(page, testInfo, "DIAG-01", 2, beforeMove, afterMove);
      throw new Error(productFailure(`MOVE after ROTATE was not world-axis dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} rotate=${String(rotate)} transform=${afterMove.oracle.inlineTransform}`));
    }
  });

  test("DIAG-02 Mentions MOVE then RESIZE commits and stays", async ({ page }, testInfo) => {
    const filters = await linkedInFilters(page);
    await selectRealTarget(page, filters.Mentions);
    const beforeMove = await captureStepSnapshot(page, filters.Mentions);
    await selectAndDragReal(page, filters.Mentions, 48, 24);
    await settleVisual(page);
    const afterMove = await captureStepSnapshot(page, filters.Mentions);
    const startWidth = afterMove.oracle.rect.width;
    await selectRealTarget(page, filters.Mentions);
    const resized = await dragHandle(page, "resize-se", 48, 28);
    expect(resized, productFailure("resize handle missing after MOVE")).toBe(true);
    await settleVisual(page);
    const afterResize = await captureStepSnapshot(page, filters.Mentions);
    if (afterResize.oracle.rect.width <= startWidth + 8) {
      await attachFailureArtifacts(page, testInfo, "DIAG-02", 2, afterMove, afterResize);
      throw new Error(productFailure(`MOVE→RESIZE snapback/no-op start=${startWidth.toFixed(1)} after=${afterResize.oracle.rect.width.toFixed(1)} detached=${String(afterResize.oracle.detached)} transform=${afterResize.oracle.inlineTransform} stored=${JSON.stringify(afterResize.oracle.storedTransform)}`));
    }
    await page.waitForTimeout(500);
    const later = await captureStepSnapshot(page, filters.Mentions);
    if (Math.abs(later.oracle.rect.width - afterResize.oracle.rect.width) > 6) {
      await attachFailureArtifacts(page, testInfo, "DIAG-02", 3, afterResize, later);
      throw new Error(productFailure("resize reverted 500ms later"));
    }
    void beforeMove;
  });

  test("DIAG-03 Mentions duplicate → resize clone independently", async ({ page }, testInfo) => {
    const filters = await linkedInFilters(page);
    await selectRealTarget(page, filters.Mentions);
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    const clone = page.locator("[data-otf-clone-id]").last();
    await expect(clone).toBeVisible();
    const sourceAfter = await captureStepSnapshot(page, filters.Mentions);
    const cloneAfter = await captureStepSnapshot(page, clone);
    if (!cloneAfter.oracle.cloneId || cloneAfter.oracle.cloneId === sourceAfter.oracle.cloneId) {
      await attachFailureArtifacts(page, testInfo, "DIAG-03", 1, sourceAfter, cloneAfter);
      throw new Error(productFailure("clone identity missing or collapsed onto source"));
    }
    const startWidth = cloneAfter.oracle.rect.width;
    await selectRealTarget(page, clone);
    const resized = await dragHandle(page, "resize-se", 40, 24);
    expect(resized, productFailure("clone resize handle missing")).toBe(true);
    await settleVisual(page);
    const afterResize = await captureStepSnapshot(page, clone);
    if (afterResize.oracle.rect.width <= startWidth + 6) {
      await attachFailureArtifacts(page, testInfo, "DIAG-03", 2, cloneAfter, afterResize);
      throw new Error(productFailure(`duplicate→resize failed start=${startWidth.toFixed(1)} after=${afterResize.oracle.rect.width.toFixed(1)}`));
    }
  });

  test("DIAG-04 duplicate Mentions then delete source immediately", async ({ page }, testInfo) => {
    const filters = await linkedInFilters(page);
    const marker = "diag-04-source";
    const box = await filters.Mentions.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.evaluate(({ x, y, marker: id }) => {
      document.elementFromPoint(x, y)?.setAttribute("data-otf-test-target", id);
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2, marker });
    const source = page.locator(`[data-otf-test-target="${marker}"]`);
    await selectRealTarget(page, source);
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    const clone = page.locator("[data-otf-clone-id]").last();
    await expect(clone).toBeVisible();
    await selectRealTarget(page, source);
    const beforeDelete = await captureStepSnapshot(page, source);
    await page.keyboard.press("Delete");
    await settleVisual(page);
    const immediatelyHidden = await source.isHidden();
    if (!immediatelyHidden) {
      const afterDelete = await captureStepSnapshot(page, source);
      await attachFailureArtifacts(page, testInfo, "DIAG-04", 1, beforeDelete, afterDelete);
      throw new Error(productFailure("source still visible immediately after delete"));
    }
    await page.waitForTimeout(2000);
    expect(await source.isHidden(), productFailure("source resurrected after 2s")).toBe(true);
    await page.waitForTimeout(8000);
    expect(await source.isHidden(), productFailure("source resurrected after 10s")).toBe(true);
    await expect(clone, productFailure("clone disappeared when source was deleted")).toBeVisible();
  });

  test("DIAG-05 Freeform lasso remains preferred after use", async ({ page }, testInfo) => {
    const filters = await linkedInFilters(page);
    const posts = await filters["My posts"].boundingBox();
    const mentions = await filters.Mentions.boundingBox();
    expect(posts && mentions).toBeTruthy();
    if (!posts || !mentions) return;
    await selectRealTarget(page, filters.All);
    await armLassoFromToolbar(page, "freeform");
    const loop = async (): Promise<void> => {
      await page.mouse.move(posts.x - 10, posts.y - 10);
      await page.mouse.down();
      await page.mouse.move(mentions.x + mentions.width + 10, posts.y - 10, { steps: 4 });
      await page.mouse.move(mentions.x + mentions.width + 10, mentions.y + mentions.height + 10, { steps: 4 });
      await page.mouse.move(posts.x - 10, mentions.y + mentions.height + 10, { steps: 4 });
      await page.mouse.move(posts.x - 10, posts.y - 10, { steps: 4 });
      await page.mouse.up();
    };
    await loop();
    const first = await getOverlayRect(page);
    await page.mouse.click(40, 40);
    await loop();
    const second = await getOverlayRect(page);
    if (!second || second.width < 40) {
      await attachFailureArtifacts(page, testInfo, "DIAG-05", 2, first, second);
      throw new Error(productFailure("second lasso after Freeform did not remain Freeform/select"));
    }
  });

  test("DIAG-06 created rectangle resize twice without rotate repair", async ({ page }, testInfo) => {
    await createKindFromToolbar(page, "rectangle", 520, 360);
    const created = page.locator("[data-otf-element-id]:not([data-otf-preview])").last();
    await expect(created).toBeVisible();
    await selectRealTarget(page, created);
    const firstStart = await captureStepSnapshot(page, created);
    expect(await dragHandle(page, "resize-se", 36, 24)).toBe(true);
    await settleVisual(page);
    const firstAfter = await captureStepSnapshot(page, created);
    if (firstAfter.oracle.rect.width <= firstStart.oracle.rect.width + 6) {
      await attachFailureArtifacts(page, testInfo, "DIAG-06", 1, firstStart, firstAfter);
      throw new Error(productFailure("first created resize failed"));
    }
    const secondStart = firstAfter;
    expect(await dragHandle(page, "resize-se", 28, 18)).toBe(true);
    await settleVisual(page);
    const secondAfter = await captureStepSnapshot(page, created);
    if (secondAfter.oracle.rect.width <= secondStart.oracle.rect.width + 4) {
      await attachFailureArtifacts(page, testInfo, "DIAG-06", 2, secondStart, secondAfter);
      throw new Error(productFailure("second created resize snapback/no-op"));
    }
  });
});
