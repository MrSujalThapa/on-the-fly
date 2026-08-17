import { enableEditMode, openFixture } from "./helpers/actions.js";
import { expect, test } from "./helpers/extension.js";
import { rect } from "./helpers/geometry.js";

test("harness loads the unpacked extension onto a real fixture page", async ({ page, context }) => {
  await openFixture(page, "simple");
  const target = page.getByTestId("target");
  await expect(target).toBeVisible();

  const before = await rect(target);
  expect(before.width).toBeGreaterThan(10);
  expect(before.height).toBeGreaterThan(10);

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  expect(worker, "MV3 service worker").toBeTruthy();

  await enableEditMode(context, page);
  await expect(page.locator("#on-the-fly-root-host")).toHaveCount(1);

  const liveRect = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  expect(liveRect.width).toBe(before.width);
  expect(liveRect.height).toBe(before.height);
});
