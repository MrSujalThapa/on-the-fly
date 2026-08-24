import {
  drag,
  enableEditMode,
  loadPersistedOperations,
  openFixture,
  reloadAndWaitForReplay,
  save,
  selectAndDrag,
  selectParent,
  selectTarget,
  undo,
} from "./helpers/actions.js";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./helpers/extension.js";
import {
  expectRectNear,
  getOverlayPipeline,
  getTransformHandleRect,
  rect,
  type GeometryRect,
  type OverlayPipeline,
} from "./helpers/geometry.js";

async function openSimilarTabs(page: Page): Promise<void> {
  await openFixture(page, "similar-tabs");
  await page.evaluate(() => {
    sessionStorage.removeItem("otf-similar-tabs");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
}

function tab(page: Page, name: string) {
  return page.getByRole("tab", { name: new RegExp(name, "u") });
}

async function hasEditorTransform(target: Locator): Promise<boolean> {
  const style = await target.evaluate((element) => {
    return {
      attr: element.getAttribute("data-otf-transform"),
      style: element.getAttribute("style") ?? "",
    };
  });
  return Boolean(style.attr) || /translate/u.test(style.style);
}

function classifyOverlay(
  label: string,
  pipeline: OverlayPipeline,
  target: GeometryRect,
): string {
  const parts = [
    `${label} outlines=${String(pipeline.outlineCount)} space=${pipeline.space ?? "none"}`,
    `model=${JSON.stringify(pipeline.model)}`,
    `renderer=${JSON.stringify(pipeline.renderer)}`,
    `rendered=${JSON.stringify(pipeline.rendered)}`,
    `target=${JSON.stringify({ x: target.x, y: target.y, width: target.width, height: target.height })}`,
  ];
  const a = pipeline.model;
  const b = pipeline.renderer;
  const c = pipeline.rendered;
  if (!a || !b || !c) {
    parts.push("class=missing-stage");
    return parts.join(" | ");
  }
  const near = (left: GeometryRect, right: GeometryRect, tolerance: number): boolean =>
    Math.abs(left.x - right.x) <= tolerance &&
    Math.abs(left.y - right.y) <= tolerance &&
    Math.abs(left.width - right.width) <= tolerance &&
    Math.abs(left.height - right.height) <= tolerance;
  const aTarget = near(a, target, 6);
  const ab = near(a, b, 1);
  const bc = near(b, c, 2);
  const scale = a.width > 1 ? c.width / a.width : 1;
  const zoomed =
    scale > 1.05 &&
    Math.abs(c.width / a.width - c.height / a.height) <= 0.05 &&
    Math.abs(c.x - a.x * scale) <= 4 &&
    Math.abs(c.y - a.y * scale) <= 4;
  if (!aTarget) {
    parts.push("class=A-wrong VisualModel measurement/binding");
  } else if (!ab) {
    parts.push("class=B-wrong OverlayCoordinator input/scheduling");
  } else if (bc) {
    parts.push("class=aligned");
  } else if (zoomed) {
    parts.push("class=aligned");
  } else {
    parts.push("class=C-wrong overlay rendering/coordinate-space");
  }
  return parts.join(" | ");
}

async function expectPipelineAligned(page: Page, target: Locator, label: string): Promise<void> {
  await expect.poll(async () => {
    const pipeline = await getOverlayPipeline(page);
    const box = await rect(target);
    if (!pipeline.model || !pipeline.renderer || !pipeline.rendered) {
      return classifyOverlay(label, pipeline, box);
    }
    const report = classifyOverlay(label, pipeline, box);
    return report.includes("class=aligned") ? "aligned" : report;
  }, { timeout: 8_000 }).toBe("aligned");
  const pipeline = await getOverlayPipeline(page);
  const box = await rect(target);
  expect(pipeline.outlineCount, `${label} single outline`).toBe(1);
  expect(pipeline.space, `${label} coordinate space`).toBe("viewport");
  expect(pipeline.model, `${label} model`).not.toBeNull();
  expect(pipeline.renderer, `${label} renderer`).not.toBeNull();
  expect(pipeline.rendered, `${label} rendered`).not.toBeNull();
  if (!pipeline.model || !pipeline.renderer || !pipeline.rendered) {
    return;
  }
  expectRectNear(pipeline.model, box, 6, `${label} A vs target`);
  expectRectNear(pipeline.renderer, pipeline.model, 1, `${label} A vs B`);
  const scale = pipeline.model.width > 1 ? pipeline.rendered.width / pipeline.model.width : 1;
  if (scale <= 1.05) {
    expectRectNear(pipeline.rendered, pipeline.renderer, 2, `${label} B vs C`);
  }
}

test.describe("B3 characterization identity persistence overlay", () => {
  test.skip(!process.env.E2E_RUNTIME_V2, "Runtime V2 B3 characterization");

  test("B3.1 similar sibling Mentions never retargets My posts", async ({ page, context }) => {
    test.setTimeout(45_000);
    await openSimilarTabs(page);
    await enableEditMode(context, page);

    const mentions = tab(page, "Mentions");
    await mentions.scrollIntoViewIfNeeded();
    const originMentions = await rect(mentions);
    const moved = await selectAndDrag(page, mentions, 80, 40);
    expect(
      Math.abs(moved.after.x - originMentions.x) + Math.abs(moved.after.y - originMentions.y),
      "Mentions must actually move before save",
    ).toBeGreaterThan(20);
    const selected = await getOverlayPipeline(page);
    expect(selected.rendered, "tab chrome after Mentions select").not.toBeNull();
    if (selected.rendered) {
      expect(selected.rendered.width).toBeLessThan((await rect(page.getByTestId("tab-list"))).width * 0.7);
    }
    await save(page);
    await page.evaluate(() => {
      const raw = sessionStorage.getItem("otf-similar-tabs");
      const parsed = raw ? JSON.parse(raw) as {
        tabs?: Array<{ key: string; label: string; badge: number }>;
        generation?: number;
      } : {};
      const tabs = parsed.tabs ?? [];
      const mentions = tabs.find((tab) => tab.key === "mentions");
      const rest = tabs.filter((tab) => tab.key !== "mentions");
      const next = [rest[1], rest[0], { key: "activity", label: "Activity", badge: 1 }, mentions, rest[2]].filter(
        (tab): tab is { key: string; label: string; badge: number } => Boolean(tab),
      );
      sessionStorage.setItem(
        "otf-similar-tabs",
        JSON.stringify({ tabs: next, generation: (parsed.generation ?? 0) + 5 }),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await expect(tab(page, "Mentions")).toBeVisible({ timeout: 10_000 });
    await expect(tab(page, "My posts")).toBeVisible({ timeout: 10_000 });

    const mentionsAfter = tab(page, "Mentions");
    const postsAfter = tab(page, "My posts");
    expect(await hasEditorTransform(postsAfter), "My posts must never receive Mentions' state").toBe(false);

    const mentionsHasTransform = await hasEditorTransform(mentionsAfter);
    if (!mentionsHasTransform) {
      expect(
        (await hasEditorTransform(tab(page, "All"))) ||
          (await hasEditorTransform(tab(page, "Jobs"))) ||
          (await hasEditorTransform(tab(page, "Activity"))),
        "unresolved Mentions must not mutate a neighbor",
      ).toBe(false);
    }
  });

  test("B3.1 live host reorder does not apply Mentions' transform to My posts", async ({
    page,
    context,
  }) => {
    test.setTimeout(30_000);
    await openSimilarTabs(page);
    await enableEditMode(context, page);
    await selectAndDrag(page, tab(page, "Mentions"), 80, 40);
    await save(page);
    await page.evaluate(() => {
      const api = (window as unknown as { __otfSimilarTabs?: Record<string, () => void> }).__otfSimilarTabs;
      api?.insertBeforeMentions?.();
      api?.reorder?.();
      api?.bumpBadges?.();
    });
    expect(await hasEditorTransform(tab(page, "My posts")), "live My posts").toBe(false);
  });

  test("B3.2 many moves and saves restore the final committed geometry", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await openFixture(page, "simple");
    await enableEditMode(context, page);
    const target = page.getByTestId("target");
    await selectTarget(page, target);
    for (let index = 0; index < 30; index += 1) {
      await drag(page, target, 6, index % 2 === 0 ? 4 : -2);
      if (index === 9 || index === 19 || index === 29) {
        await save(page);
      }
    }
    const committed = await rect(target);
    const persisted = await loadPersistedOperations(context, page);
    const moveCount = persisted.filter((operation) => operation.type === "move").length;
    expect(
      moveCount,
      `persisted MOVE count should be canonical, not historical; got ${String(moveCount)}`,
    ).toBeLessThanOrEqual(2);
    await reloadAndWaitForReplay(page);
    expectRectNear(await rect(page.getByTestId("target")), committed, 4, "30-move checkpoint");
  });

  test("B3.3 child selection does not render collection chrome", async ({ page, context }) => {
    await openFixture(page, "collection-section");
    await enableEditMode(context, page);
    const card = page.getByTestId("card-b");
    await selectAndDrag(page, card, 70, 30);
    const pipeline = await getOverlayPipeline(page);
    const cardBox = await rect(card);
    const collection = await rect(page.getByTestId("collection"));
    expect(pipeline.outlineCount, "one outline").toBe(1);
    expect(pipeline.rendered).not.toBeNull();
    if (!pipeline.rendered) {
      return;
    }
    expectRectNear(pipeline.rendered, cardBox, 8, "B chrome after move");
    expect(
      Math.abs(pipeline.rendered.width - collection.width) +
        Math.abs(pipeline.rendered.height - collection.height),
      "collection chrome must not render because B belongs to it",
    ).toBeGreaterThan(40);

    await selectParent(page);
    const parentPipeline = await getOverlayPipeline(page);
    expect(parentPipeline.rendered).not.toBeNull();
    if (!parentPipeline.rendered) {
      return;
    }
    expectRectNear(parentPipeline.rendered, await rect(page.getByTestId("collection")), 8, "explicit collection chrome");
  });

  test("B3.4 overlay pipeline A/B/C — initial scroll resize", async ({ page, context }) => {
    await openFixture(page, "simple");
    await enableEditMode(context, page);
    const target = page.getByTestId("target");
    await selectTarget(page, target);
    await expectPipelineAligned(page, target, "initial");
    await page.evaluate(() => {
      window.scrollBy(0, 140);
    });
    await expectPipelineAligned(page, target, "scroll");
    await page.setViewportSize({ width: 980, height: 620 });
    await expectPipelineAligned(page, target, "resize");
  });

  test("B3.4 overlay pipeline A/B/C — nested scroll", async ({ page, context }) => {
    await openFixture(page, "nested-scroll");
    await enableEditMode(context, page);
    const nested = page.getByTestId("nested-target");
    await nested.scrollIntoViewIfNeeded();
    await selectTarget(page, nested);
    await page.getByTestId("scroller").evaluate((element) => {
      element.scrollTop += 80;
    });
    await expectPipelineAligned(page, nested, "nested-scroll");
  });

  test("B3.4 overlay pipeline A/B/C — host layout shift", async ({ page, context }) => {
    await openFixture(page, "layout-shift");
    await enableEditMode(context, page);
    const shifted = page.getByTestId("target");
    await selectTarget(page, shifted);
    await page.evaluate(() => {
      const spacer = document.getElementById("spacer");
      if (spacer) {
        spacer.style.height = "140px";
      }
    });
    await expectPipelineAligned(page, shifted, "host-layout-shift");
  });

  test("B3.4 overlay pipeline A/B/C — transformed ancestor", async ({ page, context }) => {
    await openFixture(page, "transformed-ancestor");
    await enableEditMode(context, page);
    const nestedCard = page.getByTestId("nested-card");
    await selectTarget(page, nestedCard);
    await expectPipelineAligned(page, nestedCard, "css-transform-ancestor");
  });

  test("B3.4 overlay pipeline A/B/C — html containing block", async ({ page, context }) => {
    await openFixture(page, "html-transform");
    await enableEditMode(context, page);
    const htmlTarget = page.getByTestId("target");
    await selectTarget(page, htmlTarget);
    await expectPipelineAligned(page, htmlTarget, "html-containing-block");
  });

  test("B3.4 overlay pipeline A/B/C — animated layout", async ({ page, context }) => {
    await openFixture(page, "animated-layout");
    await enableEditMode(context, page);
    const animated = page.getByTestId("target");
    await selectTarget(page, animated);
    await page.evaluate(() => {
      const spacer = document.getElementById("spacer");
      if (spacer) {
        spacer.style.height = "120px";
      }
    });
    for (let frame = 0; frame < 6; frame += 1) {
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
      await expectPipelineAligned(page, animated, `animation-frame-${String(frame)}`);
    }
  });

  test("B3.4 overlay pipeline A/B/C — css zoom", async ({ page, context }) => {
    await openFixture(page, "simple");
    await enableEditMode(context, page);
    const zoomTarget = page.getByTestId("target");
    await selectTarget(page, zoomTarget);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1.25";
    });
    await expectPipelineAligned(page, zoomTarget, "css-zoom");
  });
});

test.describe("P1–P5 canonical MOVE checkpoints", () => {
  test.skip(!process.env.E2E_RUNTIME_V2, "Runtime V2 canonical persistence");

  test("P1 50 moves on one target persist one canonical state", async ({ page, context }) => {
    test.setTimeout(120_000);
    await openFixture(page, "simple");
    await enableEditMode(context, page);
    const target = page.getByTestId("target");
    await selectTarget(page, target);
    for (let index = 0; index < 50; index += 1) {
      await drag(page, target, 4, index % 2 === 0 ? 2 : -1);
    }
    await save(page);
    const persisted = await loadPersistedOperations(context, page);
    expect(persisted.filter((operation) => operation.type === "move")).toHaveLength(1);
    const committed = await rect(target);
    await reloadAndWaitForReplay(page);
    expectRectNear(await rect(page.getByTestId("target")), committed, 4, "P1 replay");
  });

  test("P2 alternating targets persist one MOVE each", async ({ page, context }) => {
    test.setTimeout(90_000);
    await openFixture(page, "repeated-cards");
    await enableEditMode(context, page);
    for (let index = 0; index < 6; index += 1) {
      const id = index % 2 === 0 ? "card-1" : "card-2";
      await selectAndDrag(page, page.getByTestId(id), 20, 8);
    }
    const committed = {
      b: await rect(page.getByTestId("card-1")),
      c: await rect(page.getByTestId("card-2")),
    };
    await save(page);
    const persisted = await loadPersistedOperations(context, page);
    expect(persisted.filter((operation) => operation.type === "move")).toHaveLength(2);
    await reloadAndWaitForReplay(page);
    expectRectNear(await rect(page.getByTestId("card-1")), committed.b, 5, "P2 B");
    expectRectNear(await rect(page.getByTestId("card-2")), committed.c, 5, "P2 C");
  });

  test("P3 undo before save persists the visible state", async ({ page, context }) => {
    await openFixture(page, "simple");
    await enableEditMode(context, page);
    const target = page.getByTestId("target");
    await selectAndDrag(page, target, 100, 0);
    await selectAndDrag(page, target, 100, 0);
    await undo(page);
    const visible = await rect(target);
    await save(page);
    const persisted = await loadPersistedOperations(context, page);
    expect(persisted.filter((operation) => operation.type === "move")).toHaveLength(1);
    await reloadAndWaitForReplay(page);
    expectRectNear(await rect(page.getByTestId("target")), visible, 4, "P3 +100 not +200");
  });

  test("P4 discarded redo tail does not persist", async ({ page, context }) => {
    await openFixture(page, "simple");
    await enableEditMode(context, page);
    const target = page.getByTestId("target");
    await selectAndDrag(page, target, 40, 0);
    await selectAndDrag(page, target, 40, 0);
    await undo(page);
    await selectAndDrag(page, target, 25, 10);
    const visible = await rect(target);
    await save(page);
    const persisted = await loadPersistedOperations(context, page);
    expect(persisted.filter((operation) => operation.type === "move")).toHaveLength(1);
    await reloadAndWaitForReplay(page);
    expectRectNear(await rect(page.getByTestId("target")), visible, 4, "P4 redo truncated");
  });

  test("P5 repeated checkpoints stay bounded", async ({ page, context }) => {
    test.setTimeout(90_000);
    await openFixture(page, "simple");
    await enableEditMode(context, page);
    const target = page.getByTestId("target");
    await selectTarget(page, target);
    for (let wave = 0; wave < 3; wave += 1) {
      for (let index = 0; index < 10; index += 1) {
        await drag(page, target, 5, 0);
      }
      await save(page);
      const persisted = await loadPersistedOperations(context, page);
      expect(persisted.filter((operation) => operation.type === "move").length).toBeLessThanOrEqual(2);
    }
    const committed = await rect(target);
    await reloadAndWaitForReplay(page);
    expectRectNear(await rect(page.getByTestId("target")), committed, 4, "P5 final checkpoint");
  });
});

test.describe("Runtime V2 copy/delete/resize/rotate parity", () => {
  test.beforeEach(async ({ page, context }) => {
    await openSimilarTabs(page);
    await enableEditMode(context, page);
  });

  test("copy/paste uses unique durable clones and replays before clone effects", async ({ page, context }) => {
    page.on("console", (message) => { if (message.text().includes("[otf-v2]")) console.log(message.text()); });
    await selectTarget(page, tab(page, "Mentions"));
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await page.keyboard.press("Control+v");
    await page.keyboard.press("Control+v");
    const clones = page.locator("[data-otf-clone-id]");
    await expect(clones).toHaveCount(3);
    const ids = await clones.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-otf-clone-id")));
    expect(new Set(ids).size).toBe(3);
    await save(page);
    const persisted = await loadPersistedOperations(context, page);
    expect(persisted.filter((operation) => operation.type === "duplicate")).toHaveLength(3);
    await reloadAndWaitForReplay(page);
    await expect(page.locator("[data-otf-clone-id]")).toHaveCount(3);
  });

  test("delete transaction and resize/rotate handles use one-step history", async ({ page }) => {
    const mentions = tab(page, "Mentions");
    await selectTarget(page, mentions);
    await page.keyboard.press("Delete");
    await expect(mentions).toBeHidden();
    await page.keyboard.press("Control+z");
    await expect(mentions).toBeVisible();
    await page.keyboard.press("Control+y");
    await expect(mentions).toBeHidden();
    await page.keyboard.press("Control+z");

    await selectTarget(page, mentions);
    const before = await rect(mentions);
    let handle = await getTransformHandleRect(page, "resize-se");
    expect(handle).not.toBeNull();
    if (!handle) return;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 40, handle.y + handle.height / 2 + 25, { steps: 8 });
    await page.mouse.up();
    const resized = await rect(mentions);
    expect(resized.width).toBeGreaterThan(before.width + 20);
    await page.keyboard.press("Control+z");
    expectRectNear(await rect(mentions), before, 5, "resize undo");
    await page.keyboard.press("Control+y");
    await page.waitForTimeout(100);

    handle = await getTransformHandleRect(page, "rotate");
    expect(handle).not.toBeNull();
    if (!handle) return;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 80, handle.y + 50, { steps: 8 });
    await page.mouse.up();
    expect(await page.locator(".tab-label", { hasText: /^Mentions$/u }).getAttribute("data-otf-transform")).toContain("rotate");
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+y");
  });
});
