import { getOverlayPipeline, getOverlayRect, rect, translated } from "../e2e/helpers/geometry.js";
import {
  attachRealFailureArtifacts,
  clearPageOperations,
  enableEdit,
  expect,
  nearRect,
  overlayDiagnostic,
  productFailure,
  saveReal,
  selectAndDragReal,
  selectRealTarget,
  selectedNodeSummary,
  settleVisual,
  test,
} from "./harness.js";
import {
  assertSiblingMoveIsolated,
  linkedInFilterCollectionRect,
  linkedInFilters,
  reloadLinkedInAndReplay,
  requireLinkedInAuth,
} from "./linkedin.js";

test.describe("LinkedIn notifications RL1–RL4", () => {
  test.afterEach(async ({ page, context }, testInfo) => {
    await attachRealFailureArtifacts(page, context, testInfo);
  });

  test.beforeEach(async ({ page, context }) => {
    await requireLinkedInAuth(page);
    await clearPageOperations(context, page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await linkedInFilters(page);
    await enableEdit(context, page);
  });

  test("RL1 sibling identity: Mentions move does not apply to My posts", async ({ page, context }) => {
    const filters = await linkedInFilters(page);
    const mentionsMove = { dx: 72, dy: 28 };
    const postsMove = { dx: -48, dy: 36 };

    const mentionsOrigin = await rect(filters.Mentions);
    const postsOrigin = await rect(filters["My posts"]);
    await selectAndDragReal(page, filters.Mentions, mentionsMove.dx, mentionsMove.dy);
    await saveReal(page);
    await reloadLinkedInAndReplay(page, context);
    const afterFirst = await linkedInFilters(page);
    const mentionsAfterFirst = await rect(afterFirst.Mentions);
    const postsAfterFirst = await rect(afterFirst["My posts"]);
    assertSiblingMoveIsolated({
      movedName: "Mentions",
      movedBefore: mentionsOrigin,
      movedAfter: mentionsAfterFirst,
      siblingName: "My posts",
      siblingBefore: postsOrigin,
      siblingAfter: postsAfterFirst,
      expectedDx: mentionsMove.dx,
      expectedDy: mentionsMove.dy,
    });

    await selectAndDragReal(page, afterFirst["My posts"], postsMove.dx, postsMove.dy);
    await saveReal(page);
    await reloadLinkedInAndReplay(page, context);
    const afterSecond = await linkedInFilters(page);
    const mentionsFinal = await rect(afterSecond.Mentions);
    const postsFinal = await rect(afterSecond["My posts"]);
    expect(
      nearRect(mentionsFinal, translated(mentionsOrigin, mentionsMove.dx, mentionsMove.dy), 14),
      productFailure("Mentions did not retain its saved placement after sibling save/reload"),
    ).toBe(true);
    expect(
      nearRect(postsFinal, translated(postsOrigin, postsMove.dx, postsMove.dy), 14),
      productFailure("My posts did not retain its own saved placement"),
    ).toBe(true);
  });

  test("RL2 repeated save convergence on sibling filters", async ({ page, context }) => {
    const filters = await linkedInFilters(page);
    const mentionsOrigin = await rect(filters.Mentions);
    const postsOrigin = await rect(filters["My posts"]);

    await selectAndDragReal(page, filters.Mentions, 40, 0);
    await saveReal(page);
    await selectAndDragReal(page, filters.Mentions, 0, 32);
    await saveReal(page);
    await selectAndDragReal(page, filters["My posts"], 56, 24);
    await saveReal(page);

    const mentionsCommitted = await rect(filters.Mentions);
    const postsCommitted = await rect(filters["My posts"]);
    await reloadLinkedInAndReplay(page, context);
    const reloadedFilters = await linkedInFilters(page);
    const mentionsReloaded = await rect(reloadedFilters.Mentions);
    const postsReloaded = await rect(reloadedFilters["My posts"]);
    expect(
      nearRect(mentionsReloaded, mentionsCommitted, 14),
      productFailure(
        `Mentions did not retain final committed geometry after reload committed=${JSON.stringify(mentionsCommitted)} reloaded=${JSON.stringify(mentionsReloaded)}`,
      ),
    ).toBe(true);
    expect(
      nearRect(postsReloaded, postsCommitted, 14),
      productFailure(
        `My posts did not retain final committed geometry after reload committed=${JSON.stringify(postsCommitted)} reloaded=${JSON.stringify(postsReloaded)}`,
      ),
    ).toBe(true);
    expect(
      nearRect(mentionsReloaded, translated(mentionsOrigin, 40, 32), 14),
      productFailure("Mentions final geometry did not match the repeated-save sequence"),
    ).toBe(true);
    expect(
      nearRect(postsReloaded, translated(postsOrigin, 56, 24), 14),
      productFailure("My posts final geometry did not match the repeated-save sequence"),
    ).toBe(true);
  });

  test("RL3 collection vs child: clicking Mentions selects the control, not the filter bar", async ({
    page,
  }) => {
    const filters = await linkedInFilters(page);
    const collection = await linkedInFilterCollectionRect(page);
    await selectRealTarget(page, filters.Mentions);
    const outline = await getOverlayRect(page);
    const mentionsRect = await rect(filters.Mentions);
    const summary = await selectedNodeSummary(page, filters.Mentions, collection);
    expect(outline, productFailure("no selection outline after clicking Mentions")).not.toBeNull();
    if (!outline) {
      return;
    }
    expect(
      nearRect(outline, mentionsRect, 16),
      productFailure(`Mentions click selected the filter collection instead of the control. ${JSON.stringify(summary)}`),
    ).toBe(true);
    expect(
      Math.abs(outline.width - collection.width) + Math.abs(outline.height - collection.height),
      productFailure(`filter bar was the active selection. ${JSON.stringify(summary)}`),
    ).toBeGreaterThan(40);
    expect(summary.guess, productFailure(`expected child VisualNode, recorded ${JSON.stringify(summary)}`)).toBe(
      "child",
    );
  });

  test("RL4 overlay real geometry vs Mentions control", async ({ page }) => {
    const filters = await linkedInFilters(page);
    await selectRealTarget(page, filters.Mentions);

    const check = async (label: string): Promise<void> => {
      const target = await rect(filters.Mentions);
      const pipeline = await getOverlayPipeline(page);
      const outline = pipeline.rendered ?? (await getOverlayRect(page));
      expect(outline, productFailure(`${label}: rendered OTF outline missing. ${overlayDiagnostic(pipeline, target)}`)).not.toBeNull();
      if (!outline) {
        return;
      }
      expect(
        nearRect(outline, target, 8),
        productFailure(`${label}: overlay drift. ${overlayDiagnostic(pipeline, target)}`),
      ).toBe(true);
    };

    await check("initial");
    await page.evaluate(() => {
      window.scrollBy(0, 180);
    });
    await settleVisual(page);
    await check("after scroll");
    await page.setViewportSize({ width: 1100, height: 800 });
    await settleVisual(page);
    await check("after viewport resize");
    await page.setViewportSize({ width: 1440, height: 900 });
    await filters.Jobs.scrollIntoViewIfNeeded();
    await selectRealTarget(page, filters.Mentions);
    await check("after layout change/reselect");
  });
});
