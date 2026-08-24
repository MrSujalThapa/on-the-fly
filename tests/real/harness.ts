import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test as base, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { enableEditMode, reloadAndWaitForReplay, save } from "../e2e/helpers/actions.js";
import {
  getOverlayPipeline,
  getOverlayRect,
  rect,
  type GeometryRect,
  type OverlayPipeline,
} from "../e2e/helpers/geometry.js";
import { REAL_ARTIFACT_DIR } from "./constants.js";
import { launchRealSiteContext } from "./launch-context.js";
import { AUTH_NOT_CONFIGURED_MESSAGE } from "./session-status.js";

type WorkerFixtures = {
  persistentContext: BrowserContext;
};

type TestFixtures = {
  context: BrowserContext;
  page: Page;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  persistentContext: [
    // Playwright requires object destructuring even when no fixtures are used.
    // eslint-disable-next-line no-empty-pattern -- required by Playwright fixture API
    async ({}, use) => {
      const context = await launchRealSiteContext({ headless: false });
      await use(context);
      await context.close().catch(() => undefined);
    },
    { scope: "worker" },
  ],

  context: async ({ persistentContext }, use) => {
    await use(persistentContext);
  },

  page: async ({ persistentContext }, use) => {
    const page = persistentContext.pages()[0] ?? (await persistentContext.newPage());
    await use(page);
  },
});

export { expect } from "@playwright/test";

export { AUTH_NOT_CONFIGURED_MESSAGE };

export function productFailure(message: string): string {
  return `PRODUCT FAILURE: ${message}`;
}

export function siteStructureChanged(message: string): Error {
  return new Error(`TEST SELECTOR / SITE STRUCTURE CHANGED: ${message}`);
}

export async function waitVisible(locator: Locator, label: string, timeout = 25_000): Promise<Locator> {
  const target = locator.first();
  try {
    await target.waitFor({ state: "visible", timeout });
  } catch {
    throw siteStructureChanged(label);
  }
  return target;
}

export async function selectRealTarget(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box, productFailure("target bounding box missing")).not.toBeNull();
  if (!box) {
    return;
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(async () => getOverlayRect(page), { timeout: 20_000 })
    .not.toBeNull();
}

export async function dragRealTarget(page: Page, target: Locator, dx: number, dy: number): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box, productFailure("drag target bounding box missing")).not.toBeNull();
  if (!box) {
    return;
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 16 });
  await page.mouse.up();
}

export async function selectAndDragReal(
  page: Page,
  target: Locator,
  dx: number,
  dy: number,
): Promise<{ before: GeometryRect; after: GeometryRect }> {
  await selectRealTarget(page, target);
  const before = await rect(target);
  await dragRealTarget(page, target, dx, dy);
  const after = await rect(target);
  return { before, after };
}

export async function saveReal(page: Page): Promise<void> {
  await save(page);
}

export async function reloadReplay(page: Page): Promise<void> {
  await reloadAndWaitForReplay(page);
}

export async function enableEdit(context: BrowserContext, page: Page): Promise<void> {
  await enableEditMode(context, page);
}

export async function settleVisual(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
}

export function unionRect(rects: GeometryRect[]): GeometryRect {
  const left = Math.min(...rects.map((item) => item.left));
  const top = Math.min(...rects.map((item) => item.top));
  const right = Math.max(...rects.map((item) => item.right));
  const bottom = Math.max(...rects.map((item) => item.bottom));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    top,
    left,
    right,
    bottom,
  };
}

export function rectDelta(actual: GeometryRect, expected: GeometryRect): number {
  return (
    Math.abs(actual.x - expected.x) +
    Math.abs(actual.y - expected.y) +
    Math.abs(actual.width - expected.width) +
    Math.abs(actual.height - expected.height)
  );
}

export function nearRect(actual: GeometryRect, expected: GeometryRect, tolerance: number): boolean {
  return (
    Math.abs(actual.x - expected.x) <= tolerance &&
    Math.abs(actual.y - expected.y) <= tolerance &&
    Math.abs(actual.width - expected.width) <= tolerance &&
    Math.abs(actual.height - expected.height) <= tolerance
  );
}

export function overlayDiagnostic(pipeline: OverlayPipeline, target: GeometryRect): string {
  return [
    `VisualModel rect=${JSON.stringify(pipeline.model)}`,
    `OverlayCoordinator input rect=${JSON.stringify(pipeline.renderer)}`,
    `rendered outline rect=${JSON.stringify(pipeline.rendered)}`,
    `target getBoundingClientRect=${JSON.stringify({
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height,
    })}`,
    `space=${pipeline.space ?? "none"} outlines=${String(pipeline.outlineCount)}`,
  ].join(" | ");
}

export async function selectedNodeSummary(
  page: Page,
  target: Locator,
  collection: GeometryRect,
): Promise<Record<string, unknown>> {
  const targetRect = await rect(target);
  const outline = await getOverlayRect(page);
  const pipeline = await getOverlayPipeline(page);
  const tag = await target.evaluate((element) => element.tagName.toLowerCase());
  const vsTarget = outline ? rectDelta(outline, targetRect) : null;
  const vsCollection = outline ? rectDelta(outline, collection) : null;
  let guess = "unknown";
  if (outline && vsTarget !== null && vsCollection !== null) {
    guess = vsTarget + 40 < vsCollection ? "child" : vsCollection + 40 < vsTarget ? "collection" : "ambiguous";
  }
  return {
    tag,
    guess,
    target: { x: targetRect.x, y: targetRect.y, width: targetRect.width, height: targetRect.height },
    collection: { x: collection.x, y: collection.y, width: collection.width, height: collection.height },
    outline,
    pipeline: {
      model: pipeline.model,
      renderer: pipeline.renderer,
      rendered: pipeline.rendered,
      space: pipeline.space,
    },
  };
}

export function sanitizeOperations(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const payload = row.payload;
    const dx =
      payload && typeof payload === "object" && "dx" in payload && typeof payload.dx === "number" ? payload.dx : null;
    const dy =
      payload && typeof payload === "object" && "dy" in payload && typeof payload.dy === "number" ? payload.dy : null;
    const identityVersion =
      row.target && typeof row.target === "object" && "identityVersion" in row.target
        ? row.target.identityVersion
        : null;
    const target = row.target && typeof row.target === "object" ? row.target as Record<string, unknown> : null;
    const signature = target?.signature && typeof target.signature === "object"
      ? target.signature as Record<string, unknown>
      : null;
    return {
      id: typeof row.id === "string" ? row.id : null,
      type: typeof row.type === "string" ? row.type : null,
      identityVersion,
      dx,
      dy,
      nodeId: typeof target?.nodeId === "string" ? target.nodeId : null,
      width: payload && typeof payload === "object" && "width" in payload ? payload.width : null,
      height: payload && typeof payload === "object" && "height" in payload ? payload.height : null,
      degrees: payload && typeof payload === "object" && "degrees" in payload ? payload.degrees : null,
      detachedWidth: payload && typeof payload === "object" && "detachedWidth" in payload ? payload.detachedWidth : null,
      detachedHeight: payload && typeof payload === "object" && "detachedHeight" in payload ? payload.detachedHeight : null,
      cssPath: typeof signature?.cssPath === "string" ? signature.cssPath : null,
      text: typeof signature?.textFingerprint === "string" ? signature.textFingerprint : null,
    };
  });
}

export async function loadSanitizedOperations(
  context: BrowserContext,
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const pageKey = await page.evaluate(() => `${location.origin}${location.pathname}`);
  const rows = await worker.evaluate(async (key) => {
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
        return [] as Array<Record<string, unknown>>;
      }
      return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const tx = db.transaction("operations", "readonly");
        const request = tx.objectStore("operations").index("pageKey").getAll(key);
        request.onsuccess = () => {
          resolve(request.result as Array<Record<string, unknown>>);
        };
        request.onerror = () => {
          reject(request.error ?? new Error("indexeddb_get_failed"));
        };
      });
    } finally {
      db.close();
    }
  }, pageKey);
  return sanitizeOperations(rows);
}

export async function clearPageOperations(context: BrowserContext, page: Page): Promise<void> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const pageKey = await page.evaluate(() => `${location.origin}${location.pathname}`);
  await worker.evaluate(async (key) => {
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
        return;
      }
      const rows = await new Promise<Array<{ id: string }>>((resolve, reject) => {
        const tx = db.transaction("operations", "readonly");
        const request = tx.objectStore("operations").index("pageKey").getAll(key);
        request.onsuccess = () => {
          resolve(request.result as Array<{ id: string }>);
        };
        request.onerror = () => {
          reject(request.error ?? new Error("indexeddb_get_failed"));
        };
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("operations", "readwrite");
        const store = tx.objectStore("operations");
        for (const row of rows) {
          store.delete(row.id);
        }
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error("indexeddb_delete_failed"));
        };
      });
    } finally {
      db.close();
    }
  }, pageKey);
}

export async function attachRealFailureArtifacts(
  page: Page,
  context: BrowserContext,
  testInfo: TestInfo,
  extras?: Record<string, unknown>,
): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) {
    return;
  }
  mkdirSync(REAL_ARTIFACT_DIR, { recursive: true });
  const pipeline = await getOverlayPipeline(page);
  const operations = await loadSanitizedOperations(context, page).catch(() => []);
  const summary = {
    test: testInfo.title,
    publicUrl: await page.evaluate(() => `${location.origin}${location.pathname}`),
    overlay: {
      model: pipeline.model,
      renderer: pipeline.renderer,
      rendered: pipeline.rendered,
      space: pipeline.space,
      outlineCount: pipeline.outlineCount,
    },
    operations,
    extras: extras ?? {},
  };
  await testInfo.attach("otf-real-diagnostics", {
    body: Buffer.from(JSON.stringify(summary, null, 2), "utf8"),
    contentType: "application/json",
  });
  const shotPath = join(
    REAL_ARTIFACT_DIR,
    `${testInfo.testId.replace(/[^a-zA-Z0-9._-]+/gu, "_")}-failure.png`,
  );
  await page.screenshot({ path: shotPath, fullPage: false }).catch(() => undefined);
}
