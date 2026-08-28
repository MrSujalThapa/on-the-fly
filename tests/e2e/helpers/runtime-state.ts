import { expect, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { getOverlayRect, waitForReplaySettle, type GeometryRect } from "./geometry.js";

/**
 * Site-independent access to Runtime V2 state: the diagnostics mirror, the
 * runtime reset API, the persisted operation store, and the clean-state
 * contract every behavioural case starts from. Shared by the authenticated
 * real-site suite and the local Chromium suite.
 */

export async function extensionWorker(context: BrowserContext): Promise<Worker> {
  const existing = context
    .serviceWorkers()
    .find((worker) => worker.url().startsWith("chrome-extension://"));
  if (existing) {
    return existing;
  }
  const next = await context.waitForEvent("serviceworker", { timeout: 20_000 });
  if (!next.url().startsWith("chrome-extension://")) {
    const retry = context
      .serviceWorkers()
      .find((worker) => worker.url().startsWith("chrome-extension://"));
    if (retry) {
      return retry;
    }
  }
  return next;
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
  return { x: left, y: top, width: right - left, height: bottom - top, top, left, right, bottom };
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
      detachedHeight: payload && typeof payload === "object" && "detachedHeight" in payload
        ? payload.detachedHeight
        : null,
      cssPath: typeof signature?.cssPath === "string" ? signature.cssPath : null,
      text: typeof signature?.textFingerprint === "string" ? signature.textFingerprint : null,
    };
  });
}

async function readOperationRows(
  context: BrowserContext,
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  const worker = await extensionWorker(context);
  const pageKey = await page.evaluate(() => `${location.origin}${location.pathname.replace(/\/+$/u, "") || "/"}`);
  return worker.evaluate(async (key) => {
    // Opening without a version would CREATE an empty database on a fresh
    // profile, permanently hiding the extension's own schema upgrade.
    const known = await indexedDB.databases();
    if (!known.some((entry) => entry.name === "on_the_fly_v1")) {
      return [] as Array<Record<string, unknown>>;
    }
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
}

export async function loadSanitizedOperations(
  context: BrowserContext,
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  return sanitizeOperations(await readOperationRows(context, page));
}

async function wipeOperationsStore(worker: Worker): Promise<number> {
  const result = await worker.evaluate(async () => {
    // A version-less open creates the database, so absence must be detected
    // before opening; otherwise the extension never runs its schema upgrade.
    const known = await indexedDB.databases();
    if (!known.some((entry) => entry.name === "on_the_fly_v1")) {
      return { after: 0 };
    }
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
        // A database without the real schema can only have come from a
        // version-less open; drop it so the extension recreates it correctly.
        db.close();
        await new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase("on_the_fly_v1");
          request.onsuccess = () => {
            resolve();
          };
          request.onerror = () => {
            resolve();
          };
          request.onblocked = () => {
            resolve();
          };
        });
        return { after: 0 };
      }
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("operations", "readwrite");
        tx.oncomplete = () => {
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error ?? new Error("indexeddb_clear_failed"));
        };
        tx.onabort = () => {
          reject(tx.error ?? new Error("indexeddb_clear_aborted"));
        };
        tx.objectStore("operations").clear();
      });
      return await new Promise<{ after: number }>((resolve, reject) => {
        const tx = db.transaction("operations", "readonly");
        const request = tx.objectStore("operations").count();
        request.onsuccess = () => {
          resolve({ after: request.result });
        };
        request.onerror = () => {
          reject(request.error ?? new Error("indexeddb_count_failed"));
        };
      });
    } finally {
      db.close();
    }
  });
  return result.after;
}

export async function clearPageOperations(context: BrowserContext, _page: Page): Promise<void> {
  const worker = await extensionWorker(context);
  const remaining = await wipeOperationsStore(worker);
  if (remaining > 0) {
    throw new Error(`clearPageOperations left ${String(remaining)} operations in IndexedDB`);
  }
}

export interface RuntimeDiagnostics {
  session: number;
  replayGeneration: number;
  started: boolean;
  cursor: number;
  entries: number;
  persistedRevision: number;
  dirty: boolean;
  saveStatus: string;
  activeCount: number;
  active: Array<{ id: string; type: string; nodeId: string | null; cssPath: string | null; text: string | null }>;
  selection: string[];
  selectionDetail: Array<{
    nodeId: string;
    bound: boolean;
    tag?: string;
    text?: string;
    rect?: [number, number, number, number];
  }>;
  selectionSource: string | null;
  lastPick: Record<string, unknown> | null;
  gesture: string | null;
  armedLasso: string | null;
  preferredLasso: string | null;
  armedCreate: string | null;
  groups: string[];
  clipboard: number;
  reapply: Array<{ seq: number; reason: string; session: number; cursor: number; operations: string[] }>;
}

export async function readRuntimeDiagnostics(page: Page): Promise<RuntimeDiagnostics | null> {
  const raw = await page
    .evaluate(() => document.documentElement.getAttribute("data-otf-diag"))
    .catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RuntimeDiagnostics;
  } catch {
    return null;
  }
}

export interface RuntimeResetResult {
  ok: boolean;
  ledgerEntries: number;
  activeOperations: number;
  selection: number;
  groups: number;
  pendingGestures: number;
  clipboardItems: number;
  ownedNodes: number;
  managedNodes: number;
  session: number;
}

/**
 * Drives the real Runtime V2 reset API and returns its post-conditions. The
 * runtime, not the harness, owns clearing operation state.
 */
export async function resetRuntimeSession(page: Page): Promise<RuntimeResetResult> {
  const result = await page.evaluate(async () => {
    document.documentElement.removeAttribute("data-otf-diag-reset");
    document.dispatchEvent(new CustomEvent("otf-diagnostics-reset"));
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const raw = document.documentElement.getAttribute("data-otf-diag-reset");
      if (raw) return raw;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    }
    return null;
  });
  if (!result) {
    throw new Error("HARNESS FAILURE: runtime reset hook did not respond (is this a diagnostics build?)");
  }
  return JSON.parse(result) as RuntimeResetResult;
}

/**
 * The clean-state contract every acceptance case starts from. Fails loudly
 * instead of letting a case run on residue from the previous case.
 */
export async function assertCleanEditorState(
  context: BrowserContext,
  page: Page,
  label: string,
): Promise<void> {
  const storedOps = await loadSanitizedOperations(context, page).catch(() => []);
  const diag = await readRuntimeDiagnostics(page);
  const surface = await page.evaluate(() => ({
    managed: document.querySelectorAll("[data-otf-managed],[data-otf-transform],[data-otf-detached]").length,
    owned: document.querySelectorAll("[data-otf-element-id],[data-otf-clone-id]").length,
    hidden: document.querySelectorAll("[data-otf-hidden]").length,
  }));
  const overlay = await getOverlayRect(page);
  const problems: string[] = [];
  if (storedOps.length !== 0) problems.push(`storedOps=${String(storedOps.length)}`);
  if (surface.managed !== 0) problems.push(`managedNodes=${String(surface.managed)}`);
  if (surface.owned !== 0) problems.push(`ownedNodes=${String(surface.owned)}`);
  if (surface.hidden !== 0) problems.push(`hiddenNodes=${String(surface.hidden)}`);
  if (diag) {
    if (diag.activeCount !== 0) problems.push(`activeOps=${String(diag.activeCount)}`);
    if (diag.entries !== 0) problems.push(`ledgerEntries=${String(diag.entries)}`);
    if (diag.selection.length !== 0) problems.push(`selection=${String(diag.selection.length)}`);
    if (diag.groups.length !== 0) problems.push(`groups=${String(diag.groups.length)}`);
    if (diag.gesture) problems.push(`gesture=${diag.gesture}`);
    if (diag.clipboard !== 0) problems.push(`clipboard=${String(diag.clipboard)}`);
  } else {
    problems.push("runtime diagnostics unavailable");
  }
  if (overlay) problems.push(`overlay=${overlay.width.toFixed(1)}x${overlay.height.toFixed(1)}`);
  if (problems.length > 0) {
    throw new Error(`HARNESS FAILURE: ${label} did not start clean (${problems.join(" ")})`);
  }
}

export async function resetPersistedPage(context: BrowserContext, page: Page): Promise<void> {
  const url = page.url();
  const surfaceDirty = (): Promise<boolean> =>
    page.evaluate(() => Boolean(document.querySelector("[data-otf-managed],[data-otf-transform],[data-otf-detached]")));
  const waitClean = async (timeout: number, stableMs: number): Promise<boolean> => {
    const started = Date.now();
    let cleanSince: number | null = null;
    while (Date.now() - started < timeout) {
      const dirty = await surfaceDirty().catch(() => true);
      if (!dirty) {
        cleanSince ??= Date.now();
        if (Date.now() - cleanSince >= stableMs) {
          return true;
        }
      } else {
        cleanSince = null;
      }
      await page.waitForTimeout(200);
    }
    return Boolean(cleanSince && Date.now() - cleanSince >= stableMs);
  };
  const open = async (): Promise<void> => {
    await page.goto("about:blank", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    await clearPageOperations(context, page);
    if (url.startsWith("http")) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await waitForReplaySettle(page);
      // The freshly loaded runtime may have hydrated a replay that raced the
      // IndexedDB wipe. Drive the real reset API so the ledger is provably
      // empty before the next case starts editing.
      const reset = await resetRuntimeSession(page).catch(() => null);
      if (reset && !reset.ok) {
        throw new Error(`RUNTIME RESET INCOMPLETE: ${JSON.stringify(reset)}`);
      }
    }
  };
  await clearPageOperations(context, page);
  await open();
  if (!(await waitClean(20_000, 6_000))) {
    await clearPageOperations(context, page);
    await open();
    await waitClean(20_000, 6_000);
  }
  if (await surfaceDirty().catch(() => true)) {
    throw new Error("HARNESS FAILURE: persisted transforms still present after resetPersistedPage");
  }
}

async function managedCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    document.querySelectorAll("[data-otf-managed],[data-otf-transform],[data-otf-detached]").length,
  ).catch(() => Number.POSITIVE_INFINITY);
}

export async function waitManagedStableZero(page: Page, stableMs: number): Promise<boolean> {
  const deadline = Date.now() + stableMs + 8_000;
  let cleanSince: number | null = null;
  while (Date.now() < deadline) {
    const count = await managedCount(page);
    if (count === 0) {
      cleanSince ??= Date.now();
      if (Date.now() - cleanSince >= stableMs) {
        return true;
      }
    } else {
      return false;
    }
    await page.waitForTimeout(200);
  }
  return false;
}

/**
 * Identity invariants that hold on any page: one durable id per live element,
 * and every selected node still bound to a measurable element.
 */
export interface IdentityAudit {
  duplicateElementIds: string[];
  duplicateCloneIds: string[];
  unboundSelection: string[];
  boxlessSelection: string[];
}

export async function auditIdentity(page: Page): Promise<IdentityAudit> {
  const dom = await page.evaluate(() => {
    const collect = (attribute: string): string[] =>
      Array.from(document.querySelectorAll(`[${attribute}]`))
        .map((element) => element.getAttribute(attribute) ?? "")
        .filter((value) => value.length > 0);
    const duplicates = (values: string[]): string[] => {
      const seen = new Map<string, number>();
      for (const value of values) seen.set(value, (seen.get(value) ?? 0) + 1);
      return [...seen.entries()].filter(([, count]) => count > 1).map(([value]) => value);
    };
    return {
      duplicateElementIds: duplicates(collect("data-otf-element-id")),
      duplicateCloneIds: duplicates(collect("data-otf-clone-id")),
    };
  });
  const diag = await readRuntimeDiagnostics(page);
  const unboundSelection: string[] = [];
  const boxlessSelection: string[] = [];
  for (const detail of diag?.selectionDetail ?? []) {
    if (!detail.bound) {
      unboundSelection.push(detail.nodeId);
      continue;
    }
    const size = detail.rect;
    if (size && (size[2] <= 0 || size[3] <= 0)) boxlessSelection.push(detail.nodeId);
  }
  return { ...dom, unboundSelection, boxlessSelection };
}

export function expectIdentityClean(audit: IdentityAudit, label: string): void {
  expect(audit.duplicateElementIds, `${label} duplicate elementIds`).toEqual([]);
  expect(audit.duplicateCloneIds, `${label} duplicate cloneIds`).toEqual([]);
  expect(audit.unboundSelection, `${label} unbound selection`).toEqual([]);
  expect(audit.boxlessSelection, `${label} boxless selection`).toEqual([]);
}
