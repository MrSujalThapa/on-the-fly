import {
  drag,
  enableEditMode,
  openFixture,
  redo,
  reloadAndWaitForReplay,
  save,
  selectAndDrag,
  selectTarget,
  undo,
} from "./helpers/actions.js";
import { expect, test } from "./helpers/extension.js";
import {
  expectRectNear,
  expectUnchanged,
  getOverlayRect,
  rect,
  snapshotLayout,
  translated,
} from "./helpers/geometry.js";

test.describe("product contract E1–E12", () => {
  test("E1 exact selected target among repeated siblings", async ({ page, context }) => {
    await openFixture(page, "repeated-cards");
    await enableEditMode(context, page);

    const card3 = page.getByTestId("card-3");
    const before = await snapshotLayout(page, "[data-testid^='card-']");
    await selectAndDrag(page, card3, 80, 40);
    const after = await snapshotLayout(page, "[data-testid^='card-']");

    const origin = before["card-3"];
    expect(origin).toBeDefined();
    if (!origin) {
      return;
    }
    expectRectNear(after["card-3"] ?? origin, translated(origin, 80, 40), 4, "card-3");
    expectUnchanged(before, after, ["card-1", "card-2", "card-4"]);
  });

  test("E2 first move uses one drag", async ({ page, context }) => {
    await openFixture(page, "simple");
    await enableEditMode(context, page);

    const target = page.getByTestId("target");
    const { before, after } = await selectAndDrag(page, target, 100, 60);
    expectRectNear(after, translated(before, 100, 60), 4, "first-move");
  });

  test("E3 repeated move composition is +150 not last-delta", async ({ page, context }) => {
    await openFixture(page, "simple");
    await enableEditMode(context, page);

    const target = page.getByTestId("target");
    const origin = await rect(target);
    await selectAndDrag(page, target, 100, 0);
    await drag(page, target, 50, 0);
    const finalRect = await rect(target);
    expectRectNear(finalRect, translated(origin, 150, 0), 6, "composed-move");
  });

  test("E4 flex siblings do not collapse or teleport", async ({ page, context }) => {
    await openFixture(page, "flex");
    await enableEditMode(context, page);

    const before = await snapshotLayout(page, "[data-testid^='flex-']");
    await selectAndDrag(page, page.getByTestId("flex-2"), 90, 50);
    const after = await snapshotLayout(page, "[data-testid^='flex-']");
    expectUnchanged(before, after, ["flex-1", "flex-3"]);
  });

  test("E4 grid siblings do not collapse or teleport", async ({ page, context }) => {
    await openFixture(page, "grid");
    await enableEditMode(context, page);

    const before = await snapshotLayout(page, "[data-testid^='grid-']");
    await selectAndDrag(page, page.getByTestId("grid-2"), 80, 40);
    const after = await snapshotLayout(page, "[data-testid^='grid-']");
    expectUnchanged(before, after, ["grid-1", "grid-3", "grid-4", "grid-5", "grid-6"]);
  });

  test("E4 section layout siblings stay put", async ({ page, context }) => {
    await openFixture(page, "section-layout");
    await enableEditMode(context, page);

    const before = {
      header: await rect(page.getByTestId("header")),
      aside: await rect(page.getByTestId("aside")),
      footer: await rect(page.getByTestId("footer")),
    };
    await selectAndDrag(page, page.getByTestId("section-card"), 70, 40);
    expectRectNear(await rect(page.getByTestId("header")), before.header, 4, "header");
    expectRectNear(await rect(page.getByTestId("aside")), before.aside, 4, "aside");
    expectRectNear(await rect(page.getByTestId("footer")), before.footer, 4, "footer");
  });

  test("E5 save/reload geometry equals committed geometry", async ({ page, context }) => {
    await openFixture(page, "simple");
    await enableEditMode(context, page);

    const target = page.getByTestId("target");
    const { after: committed } = await selectAndDrag(page, target, 90, 50);
    await save(page);
    await reloadAndWaitForReplay(page);
    const replayed = await rect(page.getByTestId("target"));
    expectRectNear(replayed, committed, 4, "save-reload");
  });

  test("E6 multiple edits all survive reload", async ({ page, context }) => {
    test.setTimeout(90_000);
    await openFixture(page, "repeated-cards");
    await enableEditMode(context, page);

    const a = await selectAndDrag(page, page.getByTestId("card-1"), 40, 20);
    const b = await selectAndDrag(page, page.getByTestId("card-2"), 60, -10);
    const c = await selectAndDrag(page, page.getByTestId("card-3"), 30, 50);
    await save(page);
    await reloadAndWaitForReplay(page);

    expectRectNear(await rect(page.getByTestId("card-1")), a.after, 5, "card-1 replay");
    expectRectNear(await rect(page.getByTestId("card-2")), b.after, 5, "card-2 replay");
    expectRectNear(await rect(page.getByTestId("card-3")), c.after, 5, "card-3 replay");
  });

  test("E7 undo restores original geometry and redo restores the move", async ({ page, context }) => {
    await openFixture(page, "simple");
    await enableEditMode(context, page);

    const target = page.getByTestId("target");
    const { before, after } = await selectAndDrag(page, target, 80, 40);
    await undo(page);
    expectRectNear(await rect(target), before, 4, "undo");
    await redo(page);
    expectRectNear(await rect(target), after, 4, "redo");
  });

  test("E8 React replacement follows the logical element", async ({ page, context }) => {
    await openFixture(page, "react-rerender");
    await enableEditMode(context, page);

    const target = page.getByTestId("logical-a");
    const { before, after } = await selectAndDrag(page, target, 80, 40);
    await page.locator("#replace-dom").click();

    const replacement = page.getByTestId("logical-a");
    await expect(replacement).toHaveCount(1);
    expect(await replacement.evaluate((element) => element.isConnected)).toBe(true);

    const next = await rect(replacement);
    expectRectNear(next, after, 6, "logical-a after replace");
    expect(
      Math.abs(next.x - before.x) + Math.abs(next.y - before.y),
      "replacement must not silently sit at the original unmoved rect while a move was committed",
    ).toBeGreaterThan(20);
  });

  test("E9 overlay tracks the target across viewport scroll", async ({ page, context }) => {
    await openFixture(page, "sticky");
    await enableEditMode(context, page);

    const target = page.getByTestId("target");
    await selectTarget(page, target);
    const beforeTarget = await rect(target);
    const beforeOutline = await getOverlayRect(page);
    expect(beforeOutline).not.toBeNull();
    if (!beforeOutline) {
      return;
    }
    expectRectNear(beforeOutline, beforeTarget, 6, "outline before scroll");

    await page.evaluate(() => {
      window.scrollBy(0, 180);
    });
    const afterTarget = await rect(target);
    const afterOutline = await getOverlayRect(page);
    expect(afterOutline).not.toBeNull();
    if (!afterOutline) {
      return;
    }
    expectRectNear(afterOutline, afterTarget, 6, "outline after scroll");
  });

  test("E10 overlay tracks the target inside nested overflow scroll", async ({ page, context }) => {
    await openFixture(page, "nested-scroll");
    await enableEditMode(context, page);

    const scroller = page.getByTestId("scroller");
    await scroller.evaluate((element) => {
      element.scrollTop = 220;
    });

    const target = page.getByTestId("nested-target");
    await selectTarget(page, target);
    const beforeTarget = await rect(target);
    const beforeOutline = await getOverlayRect(page);
    expect(beforeOutline).not.toBeNull();
    if (!beforeOutline) {
      return;
    }
    expectRectNear(beforeOutline, beforeTarget, 6, "nested outline before");

    await scroller.evaluate((element) => {
      element.scrollTop += 80;
    });
    const afterTarget = await rect(target);
    const afterOutline = await getOverlayRect(page);
    expect(afterOutline).not.toBeNull();
    if (!afterOutline) {
      return;
    }
    expectRectNear(afterOutline, afterTarget, 6, "nested outline after");
  });

  test("E11 overlay stays aligned after viewport resize", async ({ page, context }) => {
    await openFixture(page, "simple");
    await enableEditMode(context, page);

    const target = page.getByTestId("target");
    await selectTarget(page, target);
    await page.setViewportSize({ width: 900, height: 560 });
    const afterTarget = await rect(target);
    const afterOutline = await getOverlayRect(page);
    expect(afterOutline).not.toBeNull();
    if (!afterOutline) {
      return;
    }
    expectRectNear(afterOutline, afterTarget, 6, "outline after resize");
  });

  test("E12 deterministic stress: 20 moves then save/reload", async ({ page, context }) => {
    test.setTimeout(120_000);
    await openFixture(page, "repeated-cards");
    await enableEditMode(context, page);

    const sequence: Array<{ id: "card-1" | "card-2" | "card-3" | "card-4"; dx: number; dy: number }> = [];
    const ids = ["card-1", "card-2", "card-3", "card-4"] as const;
    for (let index = 0; index < 20; index += 1) {
      const id = ids[index % ids.length] ?? "card-1";
      sequence.push({ id, dx: 12 + (index % 5) * 4, dy: (index % 3) * 8 - 8 });
    }

    const origins: Record<string, Awaited<ReturnType<typeof rect>>> = {
      "card-1": await rect(page.getByTestId("card-1")),
      "card-2": await rect(page.getByTestId("card-2")),
      "card-3": await rect(page.getByTestId("card-3")),
      "card-4": await rect(page.getByTestId("card-4")),
    };

    for (const step of sequence) {
      const target = page.getByTestId(step.id);
      await selectTarget(page, target);
      await drag(page, target, step.dx, step.dy);
    }

    const committed = await snapshotLayout(page, "[data-testid^='card-']");
    for (const id of ids) {
      expect(committed[id]).toBeDefined();
      const origin = origins[id];
      const moved = committed[id];
      if (!origin || !moved) {
        continue;
      }
      expect(
        Math.abs(moved.x - origin.x) + Math.abs(moved.y - origin.y),
        `${id} should have moved during stress`,
      ).toBeGreaterThan(8);
    }

    await save(page);
    await reloadAndWaitForReplay(page);
    const replayed = await snapshotLayout(page, "[data-testid^='card-']");
    for (const id of ids) {
      const expected = committed[id];
      const actual = replayed[id];
      expect(expected).toBeDefined();
      expect(actual).toBeDefined();
      if (!expected || !actual) {
        continue;
      }
      expectRectNear(actual, expected, 8, `${id} stress replay`);
    }
  });
});

test.describe("product contract E13–E14", () => {
  test.skip(!process.env.E2E_RUNTIME_V2, "Runtime V2 verification-only contract");

  test("E13 failed geometry verification rolls back and leaves the ledger clean", async ({
    page,
    context,
  }) => {
    await openFixture(page, "hostile-transform");
    await enableEditMode(context, page);

    const target = page.getByTestId("locked");
    const before = await rect(target);
    await selectAndDrag(page, target, 90, 50);
    const after = await rect(target);
    expectRectNear(after, before, 4, "locked remains unmoved");

    await save(page);
    await reloadAndWaitForReplay(page);
    expectRectNear(await rect(page.getByTestId("locked")), before, 4, "no persisted failed move");
  });

  test("E14 target replaced mid-gesture does not commit an uncertain identity", async ({
    page,
    context,
  }) => {
    await openFixture(page, "replace-mid-gesture");
    await enableEditMode(context, page);

    const target = page.getByTestId("logical-x");
    const sibling = page.getByTestId("sibling");
    const beforeTarget = await rect(target);
    const beforeSibling = await rect(sibling);
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.evaluate(() => {
      const replace = (window as unknown as { __otfReplaceLogicalX?: () => void }).__otfReplaceLogicalX;
      replace?.();
    });
    await page.mouse.move(startX + 80, startY + 40, { steps: 12 });
    await page.mouse.up();

    const replacement = page.getByTestId("logical-x");
    await expect(replacement).toHaveCount(1);
    expect(await replacement.evaluate((element) => element.isConnected)).toBe(true);
    expectRectNear(await rect(page.getByTestId("sibling")), beforeSibling, 4, "sibling untouched");

    const next = await rect(replacement);
    const delta = Math.abs(next.x - beforeTarget.x) + Math.abs(next.y - beforeTarget.y);
    if (delta > 20) {
      expectRectNear(next, translated(beforeTarget, 80, 40), 8, "rebound logical-x");
    } else {
      expectRectNear(next, beforeTarget, 8, "cancelled logical-x");
    }
  });
});
