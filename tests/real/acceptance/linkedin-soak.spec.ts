import { applyOpacityFromToolbar, createKindFromToolbar, invokeLayerCommand } from "../chrome-ui.js";
import { dragHandle } from "../oracles.js";
import {
  enableEdit,
  expect,
  resetPersistedPage,
  saveReal,
  selectAndDragReal,
  selectRealTarget,
  settleVisual,
  test,
} from "../harness.js";
import { linkedInFilter, linkedInFilters, reloadLinkedInAndReplay, requireLinkedInAuth } from "../linkedin.js";

test("deep soak: 250 edits, 50 saves, 10 reloads", async ({ page, context }) => {
  test.setTimeout(1_200_000);
  await requireLinkedInAuth(page);
  await resetPersistedPage(context, page);
  await linkedInFilters(page);
  await enableEdit(context, page);

  let operations = 0;
  let saves = 0;
  let reloads = 0;
  const names = ["All", "Jobs", "My posts", "Mentions"] as const;

  const saveCycle = async (): Promise<void> => {
    await saveReal(page);
    const host = page.locator("#on-the-fly-root-host");
    await expect.poll(async () => host.getAttribute("data-otf-save-status")).not.toBe("saving");
    const status = await host.getAttribute("data-otf-save-status");
    if (status === "failed") throw new Error(`SAVE FAILED: ${await host.getAttribute("data-otf-save-error") ?? "unknown"}`);
    saves += 1;
    if (saves % 5 === 0) {
      await reloadLinkedInAndReplay(page, context);
      reloads += 1;
    }
  };

  for (let index = 0; index < 250; index += 1) {
    const name = names[index % names.length];
    if (!name) continue;
    const target = await linkedInFilter(page, name);
    await selectRealTarget(page, target);
    const kind = index % 10;
    if (kind === 0 || kind === 5) await selectAndDragReal(page, target, 10 + (index % 6), index % 2 === 0 ? 6 : -4);
    else if (kind === 1 || kind === 6) await dragHandle(page, "resize-se", 12, 8);
    else if (kind === 2) await dragHandle(page, "rotate", 20, 10);
    else if (kind === 3) await invokeLayerCommand(page, "front");
    else if (kind === 4) {
      await page.keyboard.press("Control+c");
      await page.keyboard.press("Control+v");
      const clone = page.locator("[data-otf-clone-id]").last();
      if (await clone.isVisible().catch(() => false)) await selectAndDragReal(page, clone, 16, 8);
    } else if (kind === 7) await applyOpacityFromToolbar(page, index % 2 === 0 ? "0.8" : "1");
    else if (kind === 8) {
      await createKindFromToolbar(page, index % 3 === 0 ? "rectangle" : index % 3 === 1 ? "container" : "button", 500, 360);
      const created = page.locator("[data-otf-element-id]:not([data-otf-preview])").last();
      await dragHandle(page, "resize-se", 14, 10);
      void created;
    } else {
      await page.keyboard.press("Control+z");
      await settleVisual(page);
      await page.keyboard.press("Control+y");
    }
    operations += 1;
    if (operations % 5 === 0 && saves < 50) await saveCycle();
  }

  while (saves < 50) {
    await selectRealTarget(page, await linkedInFilter(page, "Mentions"));
    await selectAndDragReal(page, await linkedInFilter(page, "Mentions"), 8, 4);
    operations += 1;
    await saveCycle();
  }

  expect(operations, "soak operations").toBeGreaterThanOrEqual(250);
  expect(saves, "soak saves").toBeGreaterThanOrEqual(50);
  expect(reloads, "soak reloads").toBeGreaterThanOrEqual(10);
});
