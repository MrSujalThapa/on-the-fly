import {
  dragFrom,
  enableEditMode,
  enableInteractMode,
  openFixture,
  selectAndDrag,
  selectParent,
  selectTarget,
} from "./helpers/actions.js";
import { expect, test } from "./helpers/extension.js";
import {
  expectRectNear,
  getOverlayRect,
  rect,
  translated,
} from "./helpers/geometry.js";

test.describe("visual model VM1–VM8 VM12", () => {
  test.skip(!process.env.E2E_RUNTIME_V2, "Runtime V2 visual-model contract");
  test("VM1 EDIT click inside an anchor-wrapped card selects the card and does not navigate", async ({
    page,
    context,
  }) => {
    await openFixture(page, "anchor-wrapped-cards");
    await enableEditMode(context, page);
    const beforeUrl = page.url();
    await selectTarget(page, page.getByTestId("card-b-image"));
    expect(page.url()).toBe(beforeUrl);
    expect(page.url()).not.toContain("should-not-navigate");
    const outline = await getOverlayRect(page);
    const card = await rect(page.getByTestId("card-b"));
    expect(outline).not.toBeNull();
    if (!outline) {
      return;
    }
    expectRectNear(outline, card, 8, "selected card-b");
    const clicks = await page.evaluate(() => (window as unknown as { __otfHostClicks?: number }).__otfHostClicks ?? 0);
    expect(clicks).toBe(0);
  });

  test("VM2 image, title, and footer resolve to the same visual unit", async ({ page, context }) => {
    await openFixture(page, "anchor-wrapped-cards");
    await enableEditMode(context, page);
    const card = page.getByTestId("card-a");
    await selectTarget(page, page.getByTestId("card-a-image"));
    const fromImage = await getOverlayRect(page);
    await selectTarget(page, page.getByTestId("card-a-title"));
    const fromTitle = await getOverlayRect(page);
    await selectTarget(page, page.getByTestId("card-a-footer"));
    const fromFooter = await getOverlayRect(page);
    const expected = await rect(card);
    expect(fromImage).not.toBeNull();
    expect(fromTitle).not.toBeNull();
    expect(fromFooter).not.toBeNull();
    if (!fromImage || !fromTitle || !fromFooter) {
      return;
    }
    expectRectNear(fromImage, expected, 8, "image unit");
    expectRectNear(fromTitle, expected, 8, "title unit");
    expectRectNear(fromFooter, expected, 8, "footer unit");
  });

  test("VM3 collection is not the default selection", async ({ page, context }) => {
    await openFixture(page, "anchor-wrapped-cards");
    await enableEditMode(context, page);
    await selectTarget(page, page.getByTestId("card-b"));
    const outline = await getOverlayRect(page);
    const card = await rect(page.getByTestId("card-b"));
    const collection = await rect(page.getByTestId("collection"));
    expect(outline).not.toBeNull();
    if (!outline) {
      return;
    }
    expectRectNear(outline, card, 8, "card-b selected");
    expect(
      Math.abs(outline.width - collection.width) + Math.abs(outline.height - collection.height),
      "collection must not be selected",
    ).toBeGreaterThan(40);
  });

  test("VM4 moving one card leaves siblings and the collection slot unmoved", async ({ page, context }) => {
    await openFixture(page, "anchor-wrapped-cards");
    await enableEditMode(context, page);
    const before = {
      a: await rect(page.getByTestId("card-a")),
      c: await rect(page.getByTestId("card-c")),
      collection: await rect(page.getByTestId("collection")),
    };
    await selectAndDrag(page, page.getByTestId("card-b"), 80, 40);
    expectRectNear(await rect(page.getByTestId("card-a")), before.a, 4, "card-a");
    expectRectNear(await rect(page.getByTestId("card-c")), before.c, 4, "card-c");
    expectRectNear(await rect(page.getByTestId("collection")), before.collection, 4, "collection");
  });

  test("VM5 explicit parent selection returns the collection", async ({ page, context }) => {
    await openFixture(page, "anchor-wrapped-cards");
    await enableEditMode(context, page);
    await selectTarget(page, page.getByTestId("card-b"));
    await selectParent(page);
    const outline = await getOverlayRect(page);
    const collection = await rect(page.getByTestId("collection"));
    expect(outline).not.toBeNull();
    if (!outline) {
      return;
    }
    expectRectNear(outline, collection, 8, "collection parent");
  });

  test("VM6 parent move after child move composes without duplicating group ops", async ({
    page,
    context,
  }) => {
    await openFixture(page, "anchor-wrapped-cards");
    await enableEditMode(context, page);
    const origin = {
      a: await rect(page.getByTestId("card-a")),
      b: await rect(page.getByTestId("card-b")),
      c: await rect(page.getByTestId("card-c")),
    };
    await selectAndDrag(page, page.getByTestId("card-b"), 200, 0);
    await selectParent(page);
    const box = await page.getByTestId("collection").boundingBox();
    expect(box, "collection box").not.toBeNull();
    if (!box) {
      return;
    }
    await dragFrom(page, box.x + 24, box.y + 10, 100, 0);
    expectRectNear(await rect(page.getByTestId("card-a")), translated(origin.a, 100, 0), 8, "A +100");
    expectRectNear(await rect(page.getByTestId("card-b")), translated(origin.b, 300, 0), 8, "B +300");
    expectRectNear(await rect(page.getByTestId("card-c")), translated(origin.c, 100, 0), 8, "C +100");
  });

  test("VM7 nested button still selects the card unit", async ({ page, context }) => {
    await openFixture(page, "anchor-wrapped-cards");
    await enableEditMode(context, page);
    await selectTarget(page, page.getByTestId("card-b-button"));
    const outline = await getOverlayRect(page);
    const card = await rect(page.getByTestId("card-b"));
    expect(outline).not.toBeNull();
    if (!outline) {
      return;
    }
    expectRectNear(outline, card, 8, "nested control promotes to card");
  });

  test("VM8 giant page shell is not the default unit", async ({ page, context }) => {
    await openFixture(page, "giant-wrapper");
    await enableEditMode(context, page);
    await selectTarget(page, page.getByTestId("ordinary"));
    const outline = await getOverlayRect(page);
    const ordinary = await rect(page.getByTestId("ordinary"));
    const shell = await rect(page.getByTestId("page-shell"));
    expect(outline).not.toBeNull();
    if (!outline) {
      return;
    }
    expectRectNear(outline, ordinary, 8, "ordinary content");
    expect(outline.height).toBeLessThan(shell.height * 0.5);
    expect(outline.width).toBeLessThan(shell.width * 0.7);
  });

  test("VM12 INTERACT mode lets the host keep the click", async ({ page, context }) => {
    await openFixture(page, "anchor-wrapped-cards");
    await enableEditMode(context, page);
    await enableInteractMode(page);
    await page.getByTestId("card-b-link").click();
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#should-not-navigate-b");
    expect(await getOverlayRect(page)).toBeNull();
    const clicks = await page.evaluate(() => (window as unknown as { __otfHostClicks?: number }).__otfHostClicks ?? 0);
    expect(clicks).toBeGreaterThan(0);
  });
});

test.describe("visual model VM10–VM11 overlay tracking", () => {
  test.skip(!process.env.E2E_RUNTIME_V2, "Runtime V2 visual-model contract");
  test("VM10 overlay follows a host layout shift without scroll or resize", async ({ page, context }) => {
    await openFixture(page, "layout-shift");
    await enableEditMode(context, page);
    const target = page.getByTestId("target");
    await selectTarget(page, target);
    await page.evaluate(() => {
      const spacer = document.getElementById("spacer");
      if (spacer) {
        spacer.style.height = "140px";
      }
    });
    await expect.poll(async () => {
      const outline = await getOverlayRect(page);
      const box = await rect(target);
      if (!outline) {
        return false;
      }
      return Math.abs(outline.y - box.y) <= 6 && Math.abs(outline.x - box.x) <= 6;
    }, { timeout: 8_000 }).toBe(true);
  });

  test("VM11 overlay stays aligned during a host layout animation", async ({ page, context }) => {
    await openFixture(page, "animated-layout");
    await enableEditMode(context, page);
    const target = page.getByTestId("target");
    await selectTarget(page, target);
    await page.evaluate(() => {
      const spacer = document.getElementById("spacer");
      if (spacer) {
        spacer.style.height = "120px";
      }
    });
    for (let frame = 0; frame < 8; frame += 1) {
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
      const outline = await getOverlayRect(page);
      const box = await rect(target);
      expect(outline).not.toBeNull();
      if (!outline) {
        return;
      }
      expectRectNear(outline, box, 24, `animated frame ${String(frame)}`);
    }
  });
});
