import { getOverlayPipeline, getOverlayRect, rect, translated } from "../e2e/helpers/geometry.js";
import {
  attachRealFailureArtifacts,
  clearPageOperations,
  enableEdit,
  expect,
  nearRect,
  overlayDiagnostic,
  productFailure,
  reloadReplay,
  saveReal,
  selectAndDragReal,
  selectRealTarget,
  selectedNodeSummary,
  test,
} from "./harness.js";
import { inProgressCardHrefs, inProgressCards, inProgressCollectionRect, openDevpostPortfolio } from "./devpost.js";

test.describe.configure({ mode: "serial" });

test.describe("Devpost profile RD1–RD5", () => {
  test.afterEach(async ({ page, context }, testInfo) => {
    await attachRealFailureArtifacts(page, context, testInfo);
  });

  test.beforeEach(async ({ page, context }) => {
    await openDevpostPortfolio(page);
    await clearPageOperations(context, page);
    await enableEdit(context, page);
  });

  test("RD1 link-wrapped card: EDIT click selects the card and does not navigate", async ({ page }) => {
    const cards = await inProgressCards(page);
    const card = cards[1];
    if (!card) {
      throw new Error("TEST SELECTOR / SITE STRUCTURE CHANGED: middle In Progress card missing");
    }
    const beforeUrl = page.url();
    await selectRealTarget(page, card);
    expect(page.url(), productFailure("EDIT click navigated a link-wrapped project card")).toBe(beforeUrl);
    const outline = await getOverlayRect(page);
    const cardRect = await rect(card);
    expect(outline, productFailure("no selection after clicking the project card")).not.toBeNull();
    if (!outline) {
      return;
    }
    expect(
      nearRect(outline, cardRect, 24),
      productFailure("intended card VisualNode was not selected"),
    ).toBe(true);
  });

  test("RD2 card vs collection: middle In Progress card is selected, not the row", async ({ page }) => {
    const cards = await inProgressCards(page);
    const middle = cards[1];
    if (!middle) {
      throw new Error("TEST SELECTOR / SITE STRUCTURE CHANGED: middle In Progress card missing");
    }
    const collection = await inProgressCollectionRect(page, cards);
    await selectRealTarget(page, middle);
    const outline = await getOverlayRect(page);
    const cardRect = await rect(middle);
    const summary = await selectedNodeSummary(page, middle, collection);
    expect(outline, productFailure("no selection outline after clicking middle card")).not.toBeNull();
    if (!outline) {
      return;
    }
    expect(
      nearRect(outline, cardRect, 24),
      productFailure(`individual card was not selected. ${JSON.stringify(summary)}`),
    ).toBe(true);
    expect(
      Math.abs(outline.width - collection.width) + Math.abs(outline.height - collection.height),
      productFailure(`giant collection was the active selection. ${JSON.stringify(summary)}`),
    ).toBeGreaterThan(80);
    expect(summary.guess, productFailure(`expected child VisualNode, recorded ${JSON.stringify(summary)}`)).toBe(
      "child",
    );
  });

  test("RD3 independent movement: middle card move leaves siblings unmoved", async ({ page }) => {
    const cards = await inProgressCards(page);
    const left = cards[0];
    const middle = cards[1];
    const right = cards[2];
    if (!left || !middle || !right) {
      throw new Error("TEST SELECTOR / SITE STRUCTURE CHANGED: expected left/middle/right In Progress cards");
    }
    const before = {
      left: await rect(left),
      middle: await rect(middle),
      right: await rect(right),
    };
    await selectAndDragReal(page, middle, 80, 40);
    const after = {
      left: await rect(left),
      middle: await rect(middle),
      right: await rect(right),
    };
    expect(
      nearRect(after.middle, translated(before.middle, 80, 40), 14),
      productFailure("middle card did not move"),
    ).toBe(true);
    expect(nearRect(after.left, before.left, 12), productFailure("left sibling geometry changed")).toBe(true);
    expect(nearRect(after.right, before.right, 12), productFailure("right sibling geometry changed")).toBe(true);
  });

  test("RD4 save/reload: multiple cards retain committed geometry", async ({ page, context }) => {
    const cards = await inProgressCards(page);
    const left = cards[0];
    const middle = cards[1];
    const right = cards[2];
    if (!left || !middle || !right) {
      throw new Error("TEST SELECTOR / SITE STRUCTURE CHANGED: expected left/middle/right In Progress cards");
    }
    const origin = {
      left: await rect(left),
      middle: await rect(middle),
      right: await rect(right),
    };
    await selectAndDragReal(page, left, 36, 20);
    await selectAndDragReal(page, middle, -28, 48);
    await saveReal(page);
    const committed = {
      left: await rect(left),
      middle: await rect(middle),
      right: await rect(right),
    };
    await reloadReplay(page);
    await enableEdit(context, page);
    await page.getByText(/in progress/i).first().waitFor({ state: "visible", timeout: 25_000 });
    const hrefs = await inProgressCardHrefs(page);
    const reloaded = {
      left: await rect(page.locator(`a[href*="${hrefs[0] ?? ""}"]`).first()),
      middle: await rect(page.locator(`a[href*="${hrefs[1] ?? ""}"]`).first()),
      right: await rect(page.locator(`a[href*="${hrefs[2] ?? ""}"]`).first()),
    };
    expect(
      nearRect(reloaded.left, committed.left, 14),
      productFailure("left card did not retain saved geometry"),
    ).toBe(true);
    expect(
      nearRect(reloaded.middle, committed.middle, 14),
      productFailure("middle card did not retain saved geometry"),
    ).toBe(true);
    expect(nearRect(reloaded.right, origin.right, 12), productFailure("unedited right card drifted")).toBe(true);
  });

  test("RD5 overlay real geometry vs selected card", async ({ page }) => {
    const cards = await inProgressCards(page);
    const middle = cards[1];
    if (!middle) {
      throw new Error("TEST SELECTOR / SITE STRUCTURE CHANGED: middle In Progress card missing");
    }
    await selectRealTarget(page, middle);
    const target = await rect(middle);
    const pipeline = await getOverlayPipeline(page);
    const outline = pipeline.rendered;
    expect(outline, productFailure(`rendered OTF outline missing. ${overlayDiagnostic(pipeline, target)}`)).not.toBeNull();
    if (!outline) {
      return;
    }
    expect(
      nearRect(outline, target, 8),
      productFailure(`overlay drift. ${overlayDiagnostic(pipeline, target)}`),
    ).toBe(true);
  });
});
