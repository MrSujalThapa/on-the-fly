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
  dragRealTarget,
  selectAndDragReal,
  selectRealTarget,
  settleVisual,
  test,
} from "./harness.js";
import { linkedInFilters, requireLinkedInAuth } from "./linkedin.js";
import { runScenario } from "./acceptance/driver.js";

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

  test("DIAG-07 Mentions MOVE then RESIZE then MOVE", async ({ page }, testInfo) => {
    const readLog = (): Promise<unknown> => page.evaluate(() => (globalThis as { __otfV2Log?: unknown }).__otfV2Log ?? []);
    const filters = await linkedInFilters(page);
    await selectRealTarget(page, filters.Mentions);
    await selectAndDragReal(page, filters.Mentions, 32, 12);
    await settleVisual(page);
    const afterMove = await captureStepSnapshot(page, filters.Mentions);
    const startWidth = afterMove.oracle.rect.width;
    expect(await dragHandle(page, "resize-se", 36, 22)).toBe(true);
    await settleVisual(page);
    const afterResize = await captureStepSnapshot(page, filters.Mentions);
    await page.waitForTimeout(500);
    const laterResize = await captureStepSnapshot(page, filters.Mentions);
    const beforeSecond = await captureStepSnapshot(page, filters.Mentions);
    await selectAndDragReal(page, filters.Mentions, 20, 8);
    await settleVisual(page);
    const afterSecond = await captureStepSnapshot(page, filters.Mentions);
    const dx = (afterSecond.oracle.rect.x + afterSecond.oracle.rect.width / 2) - (beforeSecond.oracle.rect.x + beforeSecond.oracle.rect.width / 2);
    const dy = (afterSecond.oracle.rect.y + afterSecond.oracle.rect.height / 2) - (beforeSecond.oracle.rect.y + beforeSecond.oracle.rect.height / 2);
    const log = await readLog();
    await attachFailureArtifacts(page, testInfo, "DIAG-07", 4, {
      afterMove,
      afterResize,
      laterResize,
      startWidth,
      log,
    }, afterSecond);
    if (afterResize.oracle.rect.width <= startWidth + 4) {
      throw new Error(productFailure(`resize no-op start=${startWidth.toFixed(1)} after=${afterResize.oracle.rect.width.toFixed(1)} stored=${JSON.stringify(afterResize.oracle.storedTransform)}`));
    }
    if (Math.hypot(dx, dy) < 6) {
      throw new Error(productFailure(`second move no-op dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} w=${afterSecond.oracle.rect.width.toFixed(1)} detached=${String(afterSecond.oracle.detached)} z=${afterSecond.oracle.computedZIndex}`));
    }
  });

  test("DIAG-09 PROFILE_SECTION pointer hit stack", async ({ page }, testInfo) => {
    const card = page.getByRole("complementary").locator("a[href*='/in/']").nth(1);
    const fallback = page.getByRole("complementary").locator("a[href*='/in/']").first();
    const target = (await card.isVisible().catch(() => false)) ? card : fallback;
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box, productFailure("profile bounding box missing")).not.toBeNull();
    if (!box) return;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const dump = await page.evaluate(({ x: px, y: py }) => {
      const stack = document.elementsFromPoint(px, py);
      const describe = (node: Element | null) => {
        if (!(node instanceof HTMLElement)) return null;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          tag: node.tagName.toLowerCase(),
          id: node.id || null,
          role: node.getAttribute("role"),
          href: node.getAttribute("href"),
          classes: Array.from(node.classList).slice(0, 8),
          text: (node.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          display: style.display,
          pointerEvents: style.pointerEvents,
          position: style.position,
          background: style.backgroundColor,
          border: `${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth}`,
          fontSize: style.fontSize,
          childElementCount: node.childElementCount,
        };
      };
      return {
        point: { x: px, y: py },
        eventTarget: describe(stack[0] ?? null),
        stack: stack.slice(0, 12).map((node) => describe(node)),
      };
    }, { x, y });
    await selectRealTarget(page, target);
    const afterSelect = await captureStepSnapshot(page, target);
    await attachFailureArtifacts(page, testInfo, "DIAG-09", 1, { locatorRect: box, dump }, afterSelect);
    if (!afterSelect.overlay) {
      throw new Error(productFailure("no overlay after selecting PROFILE_SECTION"));
    }
    if (afterSelect.overlay.height < box.height * 0.55) {
      throw new Error(productFailure(
        `selected inner fragment overlay=${afterSelect.overlay.width.toFixed(1)}x${afterSelect.overlay.height.toFixed(1)} target=${box.width.toFixed(1)}x${box.height.toFixed(1)} hit=${dump.eventTarget?.tag ?? "none"}`,
      ));
    }
    const live = async () => {
      const managed = page.locator("a[href*='/in/'][data-otf-managed='true']").first();
      return (await managed.isVisible().catch(() => false)) ? managed : target;
    };
    const moving = await live();
    const beforeRight = await captureStepSnapshot(page, moving);
    await selectAndDragReal(page, moving, 36, 0);
    await settleVisual(page);
    const afterRight = await captureStepSnapshot(page, await live());
    const rightDx = (afterRight.oracle.rect.x + afterRight.oracle.rect.width / 2) - (beforeRight.oracle.rect.x + beforeRight.oracle.rect.width / 2);
    if (rightDx < 8) {
      throw new Error(productFailure(`move right no-op dx=${rightDx.toFixed(1)} overlay=${JSON.stringify(afterRight.overlay)}`));
    }
    const current = await live();
    const beforeDown = await captureStepSnapshot(page, current);
    await selectAndDragReal(page, current, 0, 24);
    await settleVisual(page);
    const afterDown = await captureStepSnapshot(page, await live());
    const downDy = (afterDown.oracle.rect.y + afterDown.oracle.rect.height / 2) - (beforeDown.oracle.rect.y + beforeDown.oracle.rect.height / 2);
    if (downDy < 8) {
      throw new Error(productFailure(`move down no-op dy=${downDy.toFixed(1)}`));
    }
    const still = await live();
    const beforeLeft = await captureStepSnapshot(page, still);
    await selectAndDragReal(page, still, -28, 0);
    await settleVisual(page);
    const afterLeft = await captureStepSnapshot(page, await live());
    const leftDx = (afterLeft.oracle.rect.x + afterLeft.oracle.rect.width / 2) - (beforeLeft.oracle.rect.x + beforeLeft.oracle.rect.width / 2);
    if (leftDx > -8) {
      throw new Error(productFailure(`move left no-op dx=${leftDx.toFixed(1)}`));
    }
  });

  test("DIAG-10 PROFILE_SECTION move/resize/rotate sequences on host and clone", async ({ page }, testInfo) => {
    const card = page.getByRole("complementary").locator("a[href*='/in/']").nth(1);
    const fallback = page.getByRole("complementary").locator("a[href*='/in/']").first();
    const host = (await card.isVisible().catch(() => false)) ? card : fallback;
    const liveHost = async () => {
      const managed = page.locator("a[href*='/in/'][data-otf-managed='true']").first();
      return (await managed.isVisible().catch(() => false)) ? managed : host;
    };
    await selectRealTarget(page, host);
    const selected = await captureStepSnapshot(page, await liveHost());
    if (!selected.overlay || selected.overlay.height < (await host.boundingBox())!.height * 0.55) {
      throw new Error(productFailure(`host overlay still inner line ${JSON.stringify(selected.overlay)}`));
    }

    const runMoveResizeMove = async (target: typeof host, label: string) => {
      const beforeMove = await captureStepSnapshot(page, target);
      await selectAndDragReal(page, target, 28, 12);
      await settleVisual(page);
      const afterMove = await captureStepSnapshot(page, target);
      const moved = Math.hypot(
        (afterMove.oracle.rect.x + afterMove.oracle.rect.width / 2) - (beforeMove.oracle.rect.x + beforeMove.oracle.rect.width / 2),
        (afterMove.oracle.rect.y + afterMove.oracle.rect.height / 2) - (beforeMove.oracle.rect.y + beforeMove.oracle.rect.height / 2),
      );
      if (moved < 6) throw new Error(productFailure(`${label} MOVE no-op`));
      const startWidth = afterMove.oracle.rect.width;
      expect(await dragHandle(page, "resize-se", 28, 18)).toBe(true);
      await settleVisual(page);
      const afterResize = await captureStepSnapshot(page, target);
      if (afterResize.oracle.rect.width <= startWidth + 4) {
        throw new Error(productFailure(`${label} RESIZE no-op`));
      }
      const beforeSecond = await captureStepSnapshot(page, target);
      await selectAndDragReal(page, target, 18, 8);
      await settleVisual(page);
      const afterSecond = await captureStepSnapshot(page, target);
      const second = Math.hypot(
        (afterSecond.oracle.rect.x + afterSecond.oracle.rect.width / 2) - (beforeSecond.oracle.rect.x + beforeSecond.oracle.rect.width / 2),
        (afterSecond.oracle.rect.y + afterSecond.oracle.rect.height / 2) - (beforeSecond.oracle.rect.y + beforeSecond.oracle.rect.height / 2),
      );
      if (second < 6) throw new Error(productFailure(`${label} MOVE after RESIZE no-op`));
    };

    const runRotateMove = async (target: typeof host, label: string) => {
      await selectRealTarget(page, target);
      expect(await dragHandle(page, "rotate", 56, 28)).toBe(true);
      await settleVisual(page);
      const afterRotate = await captureStepSnapshot(page, target);
      if (Math.abs(Number(afterRotate.oracle.storedTransform?.rotate ?? 0)) < 3) {
        throw new Error(productFailure(`${label} ROTATE did not stick`));
      }
      const beforeMove = await captureStepSnapshot(page, target);
      await selectAndDragReal(page, target, 40, 0);
      await settleVisual(page);
      const afterMove = await captureStepSnapshot(page, target);
      const dx = (afterMove.oracle.rect.x + afterMove.oracle.rect.width / 2) - (beforeMove.oracle.rect.x + beforeMove.oracle.rect.width / 2);
      if (dx < 8) throw new Error(productFailure(`${label} ROTATE→MOVE no-op dx=${dx.toFixed(1)}`));
    };

    const runResizeRotateMove = async (target: typeof host, label: string) => {
      await selectRealTarget(page, target);
      const startWidth = (await captureStepSnapshot(page, target)).oracle.rect.width;
      expect(await dragHandle(page, "resize-se", 24, 16)).toBe(true);
      await settleVisual(page);
      const afterResize = await captureStepSnapshot(page, target);
      if (afterResize.oracle.rect.width <= startWidth + 4) {
        throw new Error(productFailure(`${label} RESIZE before ROTATE no-op`));
      }
      expect(await dragHandle(page, "rotate", 48, 24)).toBe(true);
      await settleVisual(page);
      const beforeMove = await captureStepSnapshot(page, target);
      await selectAndDragReal(page, target, 32, 10);
      await settleVisual(page);
      const afterMove = await captureStepSnapshot(page, target);
      const moved = Math.hypot(
        (afterMove.oracle.rect.x + afterMove.oracle.rect.width / 2) - (beforeMove.oracle.rect.x + beforeMove.oracle.rect.width / 2),
        (afterMove.oracle.rect.y + afterMove.oracle.rect.height / 2) - (beforeMove.oracle.rect.y + beforeMove.oracle.rect.height / 2),
      );
      if (moved < 6) throw new Error(productFailure(`${label} RESIZE→ROTATE→MOVE no-op`));
    };

    await runMoveResizeMove(await liveHost(), "host");
    await runRotateMove(await liveHost(), "host");
    await runResizeRotateMove(await liveHost(), "host");

    await selectRealTarget(page, await liveHost());
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    const clone = page.locator("[data-otf-clone-id]").last();
    await expect(clone).toBeVisible();
    await runMoveResizeMove(clone, "clone");
    await runRotateMove(clone, "clone");
    await attachFailureArtifacts(page, testInfo, "DIAG-10", 1, selected, await captureStepSnapshot(page, clone));
  });

  test("DIAG-HOST-10 rotated resize class on notification, filter, profile", async ({ page, context }, testInfo) => {
    const angles = [
      { dx: 40, dy: 18 },
      { dx: 56, dy: 28 },
      { dx: 72, dy: 20 },
    ] as const;
    const targets = ["mentions", "profile", "notification"] as const;
    for (const target of targets) {
      for (const [index, angle] of angles.entries()) {
        await runScenario(page, context, testInfo, {
          id: `HOST-10-${target}-${String(index + 1)}`,
          family: "host",
          title: `${target} rotate then resize`,
          steps: [
            { op: "select", target },
            { op: "resize", dx: 20, dy: 10 },
            { op: "rotate", dx: angle.dx, dy: angle.dy },
            { op: "resize", dx: 18, dy: 12 },
            { op: "resize", dx: 0, dy: 14 },
            { op: "resize", dx: -12, dy: 0 },
            { op: "move", dx: 24, dy: 8 },
            { op: "resize", dx: 10, dy: 8 },
          ],
        });
        await clearPageOperations(context, page);
        await page.reload({ waitUntil: "domcontentloaded" });
        await linkedInFilters(page);
        await enableEdit(context, page);
      }
    }
  });

  test("DIAG-DEEP-03 duplicate posts then resize after warmup", async ({ page, context }, testInfo) => {
    await runScenario(page, context, testInfo, {
      id: "DEEP-03",
      family: "deep",
      title: "30+ prior ops then duplicate → resize",
      steps: [
        { op: "warmup", count: 30 },
        { op: "select", target: "posts" },
        { op: "duplicate" },
        { op: "resize" },
      ],
    });
  });

  test("DIAG-HOST-12 lasso filter bar resize then members own MOVE", async ({ page }, testInfo) => {
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[otf-v2]")) console.info(text);
    });
    const filters = await linkedInFilters(page);
    const members = [filters.All, filters.Jobs, filters["My posts"], filters.Mentions];
    const liveMember = async (name: "All" | "Jobs" | "My posts" | "Mentions"): Promise<(typeof members)[number]> => {
      const managed = page.locator("[data-otf-detached='true']").filter({ hasText: new RegExp(`^${name}\\b`, "iu") });
      if (await managed.first().isVisible().catch(() => false)) return managed.first();
      return filters[name];
    };
    const snapshotMembers = async () => Promise.all([
      captureStepSnapshot(page, await liveMember("All")),
      captureStepSnapshot(page, await liveMember("Jobs")),
      captureStepSnapshot(page, await liveMember("My posts")),
      captureStepSnapshot(page, await liveMember("Mentions")),
    ]);
    const unionOf = (snaps: Awaited<ReturnType<typeof snapshotMembers>>) => {
      const rects = snaps.map((snap) => snap.oracle.rect);
      const left = Math.min(...rects.map((item) => item.x));
      const top = Math.min(...rects.map((item) => item.y));
      const right = Math.max(...rects.map((item) => item.x + item.width));
      const bottom = Math.max(...rects.map((item) => item.y + item.height));
      return { x: left, y: top, width: right - left, height: bottom - top };
    };
    const assertDerivedOverlay = async (label: string) => {
      await settleVisual(page);
      await page.waitForTimeout(250);
      const snaps = await snapshotMembers();
      const overlay = await getOverlayRect(page);
      const union = unionOf(snaps);
      const dump = {
        label,
        overlay,
        union,
        members: snaps.map((snap, index) => ({
          name: ["All", "Jobs", "My posts", "Mentions"][index],
          rect: snap.oracle.rect,
          detached: snap.oracle.detached,
          managed: snap.oracle.managed,
          position: snap.oracle.computedPosition,
          stored: snap.oracle.storedTransform,
        })),
      };
      console.info("[DIAG-HOST-12]", JSON.stringify(dump));
      if (!overlay) throw new Error(productFailure(`${label} overlay missing`));
      if (
        Math.abs(overlay.x - union.x) > 8
        || Math.abs(overlay.y - union.y) > 8
        || Math.abs(overlay.width - union.width) > 20
        || Math.abs(overlay.height - union.height) > 12
      ) {
        await attachFailureArtifacts(page, testInfo, "DIAG-HOST-12", 1, snaps[3]!, snaps[3]!);
        throw new Error(productFailure(`${label} overlay!=union overlay=${overlay.width.toFixed(1)}x${overlay.height.toFixed(1)} union=${union.width.toFixed(1)}x${union.height.toFixed(1)}`));
      }
      return snaps;
    };
    const assertAllMoved = async (
      label: string,
      before: Awaited<ReturnType<typeof snapshotMembers>>,
      dx: number,
      dy: number,
    ) => {
      await settleVisual(page);
      const after = await snapshotMembers();
      const overlay = await getOverlayRect(page);
      const deltas = after.map((snap, index) => {
        const start = before[index]!;
        const gotDx = (snap.oracle.rect.x + snap.oracle.rect.width / 2) - (start.oracle.rect.x + start.oracle.rect.width / 2);
        const gotDy = (snap.oracle.rect.y + snap.oracle.rect.height / 2) - (start.oracle.rect.y + start.oracle.rect.height / 2);
        return {
          name: ["All", "Jobs", "My posts", "Mentions"][index],
          gotDx,
          gotDy,
          detached: snap.oracle.detached,
          rect: snap.oracle.rect,
        };
      });
      console.info("[DIAG-HOST-12]", JSON.stringify({ label, overlay, deltas }));
      const otfLog = await page.evaluate(() => (globalThis as typeof globalThis & { __otfV2Log?: unknown }).__otfV2Log ?? []);
      console.info("[DIAG-HOST-12-log]", JSON.stringify(otfLog).slice(-4000));
      const failed = deltas.filter((item) => Math.abs(item.gotDx - dx) > 16 || Math.abs(item.gotDy - dy) > 16 || !item.detached);
      if (failed.length > 0) {
        throw new Error(productFailure(`${label} ${failed.map((item) => `${item.name} dx=${item.gotDx.toFixed(1)} dy=${item.gotDy.toFixed(1)} detached=${String(item.detached)}`).join("; ")} overlay=${overlay ? `${overlay.width.toFixed(1)}x${overlay.height.toFixed(1)}` : "none"}`));
      }
      await assertDerivedOverlay(label);
    };

    await armLassoFromToolbar(page, "rectangle");
    const allBox = await filters.All.boundingBox();
    const mentionsBox = await filters.Mentions.boundingBox();
    if (!allBox || !mentionsBox) throw new Error(productFailure("filter bar boxes missing"));
    await page.mouse.move(allBox.x - 12, allBox.y - 12);
    await page.mouse.down();
    await page.mouse.move(mentionsBox.x + mentionsBox.width + 12, mentionsBox.y + mentionsBox.height + 12, { steps: 10 });
    await page.mouse.up();
    await settleVisual(page);
    await assertDerivedOverlay("after-lasso");

    const beforeResize = await snapshotMembers();
    expect(await dragHandle(page, "resize-se", 36, 22)).toBe(true);
    await settleVisual(page);
    const afterResize = await assertDerivedOverlay("after-resize");
    for (const [index, snap] of afterResize.entries()) {
      const start = beforeResize[index]!;
      const grew = Math.hypot(snap.oracle.rect.width - start.oracle.rect.width, snap.oracle.rect.height - start.oracle.rect.height);
      if (grew < 4) throw new Error(productFailure(`after-resize ${["All", "Jobs", "My posts", "Mentions"][index]} did not realize new size`));
      if (!snap.oracle.detached) throw new Error(productFailure(`after-resize ${["All", "Jobs", "My posts", "Mentions"][index]} stayed attached/in-flow`));
    }

    let beforeMove = afterResize;
    await dragRealTarget(page, await liveMember("Mentions"), 24, 14);
    await assertAllMoved("move-24-14", beforeMove, 24, 14);

    beforeMove = await snapshotMembers();
    await dragRealTarget(page, await liveMember("Mentions"), -40, 20);
    await assertAllMoved("move--40-20", beforeMove, -40, 20);

    expect(await dragHandle(page, "resize-se", 24, 16)).toBe(true);
    await settleVisual(page);
    await assertDerivedOverlay("after-second-resize");

    beforeMove = await snapshotMembers();
    await dragRealTarget(page, await liveMember("Mentions"), 30, -10);
    await assertAllMoved("move-30--10", beforeMove, 30, -10);

    expect(await dragHandle(page, "rotate", 48, 24)).toBe(true);
    await settleVisual(page);
    await assertDerivedOverlay("after-rotate");
    beforeMove = await snapshotMembers();
    await dragRealTarget(page, await liveMember("Mentions"), 20, 8);
    await assertAllMoved("rotate-then-move", beforeMove, 20, 8);
  });
});
