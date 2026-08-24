import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { FIXTURE_ORIGIN } from "./extension.js";
import {
  getOverlayRect,
  getIndicatorMode,
  rect,
  waitForReplaySettle,
  type GeometryRect,
} from "./geometry.js";

export function fixtureUrl(name: string): string {
  return `${FIXTURE_ORIGIN}/${name}/`;
}

export async function openFixture(page: Page, name: string): Promise<void> {
  await page.goto(fixtureUrl(name), { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main, body");
}

export async function enableEditMode(context: BrowserContext, page: Page): Promise<void> {
  await page.bringToFront();
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const result = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
    const tab = tabs.find((entry) => entry.active && typeof entry.id === "number") ?? tabs[0];
    if (!tab?.id) {
      return { ok: false as const, error: "no_tab" };
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "OTF_EDIT_MODE_CHANGED", enabled: true });
        return { ok: true as const, tabId: tab.id };
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return { ok: false as const, error: "content_receiver_unavailable" };
  });
  expect(result.ok, `enable edit mode: ${JSON.stringify(result)}`).toBe(true);
  await page.locator("#on-the-fly-root-host").waitFor({ state: "attached", timeout: 15_000 });
}

export async function selectTarget(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  expect(box, "select target bounding box").not.toBeNull();
  if (!box) {
    return;
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => getOverlayRect(page), { timeout: 8_000 }).not.toBeNull();
}

export async function drag(page: Page, target: Locator, dx: number, dy: number): Promise<void> {
  const box = await target.boundingBox();
  expect(box, "drag target bounding box").not.toBeNull();
  if (!box) {
    return;
  }
  await dragFrom(page, box.x + box.width / 2, box.y + box.height / 2, dx, dy);
}

export async function dragFrom(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 16 });
  await page.mouse.up();
}

export async function selectAndDrag(
  page: Page,
  target: Locator,
  dx: number,
  dy: number,
): Promise<{ before: GeometryRect; after: GeometryRect }> {
  await selectTarget(page, target);
  const before = await rect(target);
  await drag(page, target, dx, dy);
  const after = await rect(target);
  return { before, after };
}

export async function save(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport, "viewport").not.toBeNull();
  if (!viewport) {
    return;
  }
  await page.mouse.click(52, viewport.height - 32);
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 250);
    });
  });
}

export async function reloadAndWaitForReplay(page: Page): Promise<void> {
  await page.reload({ waitUntil: "load" });
  await waitForReplaySettle(page);
}

export async function undo(page: Page): Promise<void> {
  await page.keyboard.press("Control+z");
}

export async function redo(page: Page): Promise<void> {
  await page.keyboard.press("Control+y");
}

export async function selectParent(page: Page): Promise<void> {
  await page.keyboard.press("Alt+ArrowUp");
}

export async function enableInteractMode(page: Page): Promise<void> {
  await page.keyboard.press("i");
  await expect.poll(async () => getIndicatorMode(page), { timeout: 8_000 }).toBe("interact");
}

export async function loadPersistedOperations(
  context: BrowserContext,
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const pageKey = await page.evaluate(() => `${location.origin}${location.pathname.replace(/\/+$/u, "") || "/"}`);
  return worker.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("on_the_fly_v1");
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("indexeddb_open_failed"));
      };
    });
    try {
      if (!db.objectStoreNames.contains("operations")) {
        return [];
      }
      const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const tx = db.transaction("operations", "readonly");
        const request = tx.objectStore("operations").index("pageKey").getAll(key);
        request.onsuccess = () => {
          resolve(request.result as Array<Record<string, unknown>>);
        };
        request.onerror = () => {
          reject(request.error ?? new Error("indexeddb_get_failed"));
        };
      });
      return rows;
    } finally {
      db.close();
    }
  }, pageKey);
}
