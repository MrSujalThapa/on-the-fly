import {
  enableEditMode,
  openFixture,
  reloadAndWaitForReplay,
  save,
  selectAndDrag,
} from "./helpers/actions.js";
import { expect, test } from "./helpers/extension.js";
import { expectRectNear, expectUnchanged, rect, snapshotLayout } from "./helpers/geometry.js";

async function openDynamicList(page: import("@playwright/test").Page): Promise<void> {
  await openFixture(page, "dynamic-list");
  await page.evaluate(() => {
    sessionStorage.removeItem("otf-dynamic-list");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function hostCall(
  page: import("@playwright/test").Page,
  name: "reorder" | "insertBeforeB" | "replaceB" | "removeB" | "rerender",
): Promise<void> {
  await page.evaluate((method) => {
    const api = (window as unknown as { __otfDynamic?: Record<string, () => void> }).__otfDynamic;
    const fn = api?.[method];
    if (typeof fn === "function") {
      fn();
    }
  }, name);
}

test.describe("dynamic replay V1–V5", () => {
  test.skip(!process.env.E2E_RUNTIME_V2, "Runtime V2 dynamic identity contract");
  test("V1 two saves survive a host rerender and restore logical X and Y", async ({ page, context }) => {
    await openDynamicList(page);
    await enableEditMode(context, page);

    const movedA = await selectAndDrag(page, page.getByTestId("item-a"), 70, 20);
    await save(page);
    await hostCall(page, "rerender");
    const movedC = await selectAndDrag(page, page.getByTestId("item-c"), 40, 30);
    await save(page);
    await reloadAndWaitForReplay(page);

    expectRectNear(await rect(page.getByTestId("item-a")), movedA.after, 8, "logical A");
    expectRectNear(await rect(page.getByTestId("item-c")), movedC.after, 8, "logical C");
  });

  test("V2 insertion before B still applies B and never the new sibling", async ({ page, context }) => {
    await openDynamicList(page);
    await enableEditMode(context, page);

    const movedB = await selectAndDrag(page, page.getByTestId("item-b"), 90, 40);
    const beforeA = await rect(page.getByTestId("item-a"));
    await save(page);
    await hostCall(page, "insertBeforeB");
    await reloadAndWaitForReplay(page);

    expect(await page.getByTestId("item-new").count()).toBe(1);
    const bTransform = await page.getByTestId("item-b").evaluate((element) => element.getAttribute("style") ?? "");
    const newTransform = await page.getByTestId("item-new").evaluate((element) => element.getAttribute("style") ?? "");
    expect(bTransform).toMatch(/translate/);
    expect(newTransform).not.toMatch(/translate/);
    const inserted = await rect(page.getByTestId("item-new"));
    expect(
      Math.abs(inserted.x - movedB.after.x) + Math.abs(inserted.y - movedB.after.y),
      "new sibling must not receive B's operation",
    ).toBeGreaterThan(20);
    expectRectNear(await rect(page.getByTestId("item-a")), beforeA, 8, "A untouched");
  });

  test("V3 sibling reorder still targets logical B", async ({ page, context }) => {
    await openDynamicList(page);
    await enableEditMode(context, page);

    const movedB = await selectAndDrag(page, page.getByTestId("item-b"), 80, 30);
    await save(page);
    await hostCall(page, "reorder");
    await reloadAndWaitForReplay(page);
    const bTransform = await page.getByTestId("item-b").evaluate((element) => element.getAttribute("style") ?? "");
    const aTransform = await page.getByTestId("item-a").evaluate((element) => element.getAttribute("style") ?? "");
    expect(bTransform).toMatch(/translate/);
    expect(aTransform).not.toMatch(/translate/);
    expect(
      Math.abs((await rect(page.getByTestId("item-b"))).x - movedB.after.x) +
        Math.abs((await rect(page.getByTestId("item-b"))).y - movedB.after.y),
      "B must still be offset, not sitting unmoved in a new slot",
    ).toBeGreaterThan(20);
  });

  test("V4 equivalent DOM replacement rebinds the visual node", async ({ page, context }) => {
    await openDynamicList(page);
    await enableEditMode(context, page);

    const movedB = await selectAndDrag(page, page.getByTestId("item-b"), 60, 25);
    await hostCall(page, "replaceB");
    const replacement = page.getByTestId("item-b");
    await expect(replacement).toHaveCount(1);
    expectRectNear(await rect(replacement), movedB.after, 8, "rebound B");
  });

  test("V5 removed target stays unresolved and does not mutate neighbors", async ({ page, context }) => {
    await openDynamicList(page);
    await enableEditMode(context, page);

    await selectAndDrag(page, page.getByTestId("item-b"), 80, 20);
    await save(page);
    await hostCall(page, "removeB");
    const neighbors = await snapshotLayout(page, "[data-testid^='item-']");
    await reloadAndWaitForReplay(page);

    expect(await page.getByTestId("item-b").count()).toBe(0);
    const after = await snapshotLayout(page, "[data-testid^='item-']");
    expectUnchanged(neighbors, after, ["item-a", "item-c"], 8);
  });
});

test.describe("visual model VM9 dynamic identity", () => {
  test.skip(!process.env.E2E_RUNTIME_V2, "Runtime V2 dynamic identity contract");
  test("VM9 wrong sibling never receives the persisted operation", async ({ page, context }) => {
    await openDynamicList(page);
    await enableEditMode(context, page);
    const movedB = await selectAndDrag(page, page.getByTestId("item-b"), 70, 35);
    await save(page);
    await hostCall(page, "insertBeforeB");
    await hostCall(page, "reorder");
    await reloadAndWaitForReplay(page);
    const bTransform = await page.getByTestId("item-b").evaluate((element) => element.getAttribute("style") ?? "");
    const newTransform = await page.getByTestId("item-new").evaluate((element) => element.getAttribute("style") ?? "");
    expect(bTransform).toMatch(/translate/);
    expect(newTransform).not.toMatch(/translate/);
    const inserted = await rect(page.getByTestId("item-new"));
    expect(
      Math.abs(inserted.x - movedB.after.x) + Math.abs(inserted.y - movedB.after.y),
    ).toBeGreaterThan(20);
  });
});
