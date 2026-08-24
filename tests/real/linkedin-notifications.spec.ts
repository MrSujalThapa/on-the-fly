import { getOverlayPipeline, getOverlayRect, getTransformHandleRect, rect, translated } from "../e2e/helpers/geometry.js";
import {
  attachRealFailureArtifacts,
  clearPageOperations,
  enableEdit,
  expect,
  loadSanitizedOperations,
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

function expectTransformStateNear(actualRaw: string | null, expectedRaw: string | null): void {
  expect(actualRaw).not.toBeNull();
  expect(expectedRaw).not.toBeNull();
  if (!actualRaw || !expectedRaw) return;
  const actual = JSON.parse(actualRaw) as Record<string, number | string | null>;
  const expected = JSON.parse(expectedRaw) as Record<string, number | string | null>;
  for (const key of ["dx", "dy", "width", "height", "rotate"] as const) {
    if (actual[key] === null || expected[key] === null) expect(actual[key]).toBe(expected[key]);
    else expect(Math.abs(Number(actual[key]) - Number(expected[key])), key).toBeLessThan(0.01);
  }
  expect(actual.position).toBe(expected.position);
}

async function verifyCloneReplay(page: import("@playwright/test").Page, expected: number): Promise<void> {
  const clones = page.locator("[data-otf-clone-id]");
  await expect(clones).toHaveCount(expected);
  const ids = await clones.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-otf-clone-id")));
  expect(new Set(ids).size).toBe(expected);
  const deletedId = ids[0];
  const movedId = ids.at(-1);
  if (!deletedId || !movedId) throw new Error(productFailure("clone identity missing"));
  const deleted = page.locator(`[data-otf-clone-id="${deletedId}"]`);
  const moved = page.locator(`[data-otf-clone-id="${movedId}"]`);
  await selectRealTarget(page, deleted);
  await page.keyboard.press("Delete");
  await expect(deleted).toBeHidden();
  await selectAndDragReal(page, moved, 28, 16);
  const movedState = await moved.getAttribute("data-otf-transform");
  await saveReal(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await linkedInFilters(page);
  await expect(page.locator("[data-otf-clone-id]")).toHaveCount(expected);
  await expect(page.locator(`[data-otf-clone-id="${deletedId}"]`)).toBeHidden();
  expectTransformStateNear(await page.locator(`[data-otf-clone-id="${movedId}"]`).getAttribute("data-otf-transform"), movedState);
}

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

  test("RL5 clipboard, delete, resize, rotate, undo/redo, and replay", async ({ page }) => {
    const copyTarget = page.getByRole("heading", { name: "Manage your notifications" });
    await selectRealTarget(page, copyTarget);
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    const clone = page.locator("[data-otf-clone-id]").last();
    await expect(clone).toBeVisible();

    await page.keyboard.press("Delete");
    await expect(clone).toBeHidden();
    await page.keyboard.press("Control+z");
    await expect(clone).toBeVisible();
    await page.keyboard.press("Control+y");
    await expect(clone).toBeHidden();
    await page.keyboard.press("Control+z");
    await selectRealTarget(page, clone);

    const before = await rect(clone);
    let handle = await getTransformHandleRect(page, "resize-se");
    expect(handle, productFailure("resize handle missing on LinkedIn clone")).not.toBeNull();
    if (!handle) return;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.right + 36, handle.bottom + 24, { steps: 8 });
    await page.mouse.up();
    expect((await rect(clone)).width).toBeGreaterThan(before.width + 15);

    handle = await getTransformHandleRect(page, "rotate");
    expect(handle, productFailure("rotate handle missing on LinkedIn clone")).not.toBeNull();
    if (!handle) return;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.right + 70, handle.bottom + 45, { steps: 8 });
    await page.mouse.up();
    await expect(clone).toHaveAttribute("data-otf-transform", /"rotate":(?!0)/u);

    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+y");
    await saveReal(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await linkedInFilters(page);
    await expect(page.locator("[data-otf-clone-id]")).toHaveCount(1);
  });

  test("RL6 My posts and Mentions transforms preview continuously and stay isolated", async ({ page, context }) => {
    const filters = await linkedInFilters(page);
    await selectRealTarget(page, filters["My posts"]);
    let handle = await getTransformHandleRect(page, "resize-se");
    expect(handle, productFailure("My posts resize handle missing")).not.toBeNull();
    if (!handle) return;
    const resizeFrames: number[] = [];
    const resizeX = handle.x + handle.width / 2;
    const resizeY = handle.y + handle.height / 2;
    await page.mouse.move(resizeX, resizeY);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(resizeX + step * 14, resizeY + step * 8);
      await settleVisual(page);
      resizeFrames.push((await rect(filters["My posts"])).width);
    }
    await page.mouse.up();
    expect(new Set(resizeFrames.map(Math.round)).size, productFailure("resize was not visible during pointermove")).toBeGreaterThan(3);
    const postsAfterResize = await rect(filters["My posts"]);
    const postsState = await filters["My posts"].getAttribute("data-otf-transform");

    await selectAndDragReal(page, filters.Mentions, 42, 24);
    await selectRealTarget(page, filters.Mentions);
    handle = await getTransformHandleRect(page, "rotate");
    expect(handle, productFailure("Mentions rotate handle missing")).not.toBeNull();
    if (!handle) return;
    const rotateFrames: string[] = [];
    const rotateX = handle.x + handle.width / 2;
    const rotateY = handle.y + handle.height / 2;
    await page.mouse.move(rotateX, rotateY);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(rotateX + step * 12, rotateY + step * 4);
      await settleVisual(page);
      rotateFrames.push((await filters.Mentions.getAttribute("data-otf-transform")) ?? "");
      expect(nearRect(await rect(filters["My posts"]), postsAfterResize, 3), productFailure("My posts changed during Mentions rotation")).toBe(true);
      expect(await filters["My posts"].getAttribute("data-otf-transform")).toBe(postsState);
    }
    await page.mouse.up();
    expect(new Set(rotateFrames).size, productFailure("rotation was not visible during pointermove")).toBeGreaterThan(3);

    await selectAndDragReal(page, filters["My posts"], 22, 18);
    await selectAndDragReal(page, filters.Mentions, -18, 16);
    await saveReal(page);
    const saved = await loadSanitizedOperations(context, page);
    const postsCommitted = await filters["My posts"].getAttribute("data-otf-transform");
    const mentionsCommitted = await filters.Mentions.getAttribute("data-otf-transform");
    await reloadLinkedInAndReplay(page, context);
    const replayed = await linkedInFilters(page);
    expectTransformStateNear(await replayed["My posts"].getAttribute("data-otf-transform"), postsCommitted);
    expectTransformStateNear(await replayed.Mentions.getAttribute("data-otf-transform"), mentionsCommitted);
    expect(saved.length).toBeGreaterThan(0);
  });

  test("RL7 reverse order and repeated alternation remain target-local", async ({ page, context }) => {
    const filters = await linkedInFilters(page);
    await selectAndDragReal(page, filters.Mentions, 36, 20);
    await selectRealTarget(page, filters.Mentions);
    let handle = await getTransformHandleRect(page, "rotate");
    expect(handle).not.toBeNull();
    if (!handle) return;
    await page.mouse.move(handle.x + 5, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 38, handle.y + 14, { steps: 6 });
    await page.mouse.up();
    let mentionsState = await filters.Mentions.getAttribute("data-otf-transform");
    const mentionsRect = await rect(filters.Mentions);

    await selectAndDragReal(page, filters["My posts"], -24, 18);
    await selectRealTarget(page, filters["My posts"]);
    handle = await getTransformHandleRect(page, "resize-se");
    expect(handle).not.toBeNull();
    if (!handle) return;
    await page.mouse.move(handle.x + 5, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 52, handle.y + 34, { steps: 6 });
    await page.mouse.up();
    expect(await filters.Mentions.getAttribute("data-otf-transform")).toBe(mentionsState);
    expect(nearRect(await rect(filters.Mentions), mentionsRect, 3)).toBe(true);

    for (let iteration = 0; iteration < 9; iteration += 1) {
      await selectRealTarget(page, filters["My posts"]);
      handle = await getTransformHandleRect(page, "resize-se");
      if (!handle) throw new Error(productFailure(`resize handle missing at iteration ${String(iteration)}`));
      const startWidth = (await rect(filters["My posts"])).width;
      await page.mouse.move(handle.x + 5, handle.y + 5);
      await page.mouse.down();
      await page.mouse.move(handle.x + 9, handle.y + 8);
      await settleVisual(page);
      const previewWidth = (await rect(filters["My posts"])).width;
      await page.mouse.move(handle.x + 14, handle.y + 11);
      await page.mouse.up();
      expect(previewWidth).not.toBe(startWidth);
      expect(await filters.Mentions.getAttribute("data-otf-transform")).toBe(mentionsState);

      await selectRealTarget(page, filters.Mentions);
      handle = await getTransformHandleRect(page, "rotate");
      if (!handle) throw new Error(productFailure(`rotate handle missing at iteration ${String(iteration)}`));
      const beforeRotate = await filters.Mentions.getAttribute("data-otf-transform");
      const postsBeforeRotate = await filters["My posts"].getAttribute("data-otf-transform");
      await page.mouse.move(handle.x + 5, handle.y + 5);
      await page.mouse.down();
      await page.mouse.move(handle.x + 25, handle.y + 7);
      await settleVisual(page);
      expect(await filters.Mentions.getAttribute("data-otf-transform")).not.toBe(beforeRotate);
      await page.mouse.move(handle.x + 38, handle.y + 11);
      await page.mouse.up();
      expect(await filters["My posts"].getAttribute("data-otf-transform")).toBe(postsBeforeRotate);
      mentionsState = await filters.Mentions.getAttribute("data-otf-transform");
    }

    await selectAndDragReal(page, filters.Mentions, 12, -8);
    await selectAndDragReal(page, filters["My posts"], 14, 10);
    const finalMentions = await filters.Mentions.getAttribute("data-otf-transform");
    const finalPosts = await filters["My posts"].getAttribute("data-otf-transform");
    await saveReal(page);
    await reloadLinkedInAndReplay(page, context);
    const replayed = await linkedInFilters(page);
    expectTransformStateNear(await replayed.Mentions.getAttribute("data-otf-transform"), finalMentions);
    expectTransformStateNear(await replayed["My posts"].getAttribute("data-otf-transform"), finalPosts);
  });

  test("RL8 group resize and rotate preview, undo, redo, ungroup, and move", async ({ page }) => {
    const filters = await linkedInFilters(page);
    await selectRealTarget(page, filters["My posts"]);
    await page.keyboard.down("Shift");
    await selectRealTarget(page, filters.Mentions);
    await page.keyboard.up("Shift");
    await page.keyboard.press("Control+g");

    const postsStart = await rect(filters["My posts"]);
    const mentionsStart = await rect(filters.Mentions);
    let handle = await getTransformHandleRect(page, "resize-se");
    expect(handle).not.toBeNull();
    if (!handle) return;
    await page.mouse.move(handle.x + 5, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 48, handle.y + 30);
    await settleVisual(page);
    expect((await rect(filters["My posts"])).width).not.toBe(postsStart.width);
    expect((await rect(filters.Mentions)).width).not.toBe(mentionsStart.width);
    await page.mouse.move(handle.x + 76, handle.y + 46);
    await page.mouse.up();
    const postsResized = await rect(filters["My posts"]);
    await page.keyboard.press("Control+z");
    expect(nearRect(await rect(filters["My posts"]), postsStart, 4)).toBe(true);
    await page.keyboard.press("Control+y");
    expect(nearRect(await rect(filters["My posts"]), postsResized, 4)).toBe(true);

    handle = await getTransformHandleRect(page, "rotate");
    expect(handle).not.toBeNull();
    if (!handle) return;
    await page.mouse.move(handle.x + 5, handle.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle.x + 45, handle.y + 16);
    await settleVisual(page);
    expect(await filters["My posts"].getAttribute("data-otf-transform")).toContain("rotate");
    expect(await filters.Mentions.getAttribute("data-otf-transform")).toContain("rotate");
    await page.mouse.move(handle.x + 68, handle.y + 24);
    await page.mouse.up();
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+y");
    await page.keyboard.press("Control+Shift+g");
    await selectAndDragReal(page, filters["My posts"], 16, 12);
    await selectAndDragReal(page, filters.Mentions, -14, 10);
  });

  test("RL9 delete stays exact across ten targets and group replay", async ({ page }) => {
    const filters = await linkedInFilters(page);
    const targets = [
      filters.All,
      filters.Jobs,
      filters["My posts"],
      filters.Mentions,
      page.getByRole("heading", { name: "Manage your notifications" }),
      page.getByRole("link", { name: "View settings" }),
      page.locator("header a:visible").nth(0),
      page.locator("header a:visible").nth(1),
      page.locator("header a:visible").nth(2),
      page.locator("header a:visible").nth(3),
    ];
    for (const [index, target] of targets.entries()) {
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      if (!box) continue;
      const marker = `rl9-${String(index)}`;
      await page.evaluate(({ x, y, marker }) => {
        document.elementFromPoint(x, y)?.setAttribute("data-otf-test-target", marker);
      }, { x: box.x + box.width / 2, y: box.y + box.height / 2, marker });
      const exactTarget = page.locator(`[data-otf-test-target="${marker}"]`);
      await selectRealTarget(page, exactTarget);
      await page.keyboard.press("Delete");
      await expect(exactTarget, `delete target ${String(index)}`).toBeHidden();
      await page.keyboard.press("Control+z");
      await expect(exactTarget, `undo target ${String(index)}`).toBeVisible();
      await page.keyboard.press("Control+y");
      await expect(exactTarget, `redo target ${String(index)}`).toBeHidden();
      await page.keyboard.press("Control+z");
      await expect(exactTarget, `final undo target ${String(index)}`).toBeVisible();
    }

    await selectRealTarget(page, filters.Jobs);
    await page.keyboard.down("Shift");
    await selectRealTarget(page, filters["My posts"]);
    await selectRealTarget(page, filters.Mentions);
    await page.keyboard.up("Shift");
    await page.keyboard.press("Control+g");
    await page.keyboard.press("Delete");
    await expect(filters.Jobs).toBeHidden();
    await expect(filters["My posts"]).toBeHidden();
    await expect(filters.Mentions).toBeHidden();
    await page.keyboard.press("Control+z");
    await expect(filters.Jobs).toBeVisible();
    await expect(filters["My posts"]).toBeVisible();
    await expect(filters.Mentions).toBeVisible();
    await page.keyboard.press("Control+y");
    await saveReal(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    for (const name of ["Jobs", "My posts", "Mentions"]) {
      const target = page.locator("button").filter({ hasText: new RegExp(`^${name}$`, "u") }).first();
      await expect(target, `${name} group delete replay`).toBeHidden();
    }
    await expect(page.getByRole("radio", { name: /^All$/u })).toBeVisible();
  });

  test("RL10 five single pastes stay unique through replay", async ({ page }) => {
    await selectRealTarget(page, page.getByRole("heading", { name: "Manage your notifications" }));
    await page.keyboard.press("Control+c");
    for (let index = 0; index < 5; index += 1) await page.keyboard.press("Control+v");
    await verifyCloneReplay(page, 5);
  });

  test("RL11 three multiselect pastes stay unique through replay", async ({ page }) => {
    await linkedInFilters(page);
    await selectRealTarget(page, page.getByRole("heading", { name: "Manage your notifications" }));
    await page.keyboard.down("Shift");
    await selectRealTarget(page, page.getByRole("link", { name: "View settings" }));
    await page.keyboard.up("Shift");
    await page.keyboard.press("Control+c");
    for (let index = 0; index < 3; index += 1) await page.keyboard.press("Control+v");
    await verifyCloneReplay(page, 6);
  });

  test("RL12 three explicit-group pastes stay unique through replay", async ({ page }) => {
    await linkedInFilters(page);
    await selectRealTarget(page, page.getByRole("heading", { name: "Manage your notifications" }));
    await page.keyboard.down("Shift");
    await selectRealTarget(page, page.getByRole("link", { name: "View settings" }));
    await page.keyboard.up("Shift");
    await page.keyboard.press("Control+g");
    await page.keyboard.press("Control+c");
    for (let index = 0; index < 3; index += 1) await page.keyboard.press("Control+v");
    await verifyCloneReplay(page, 6);
  });
});
