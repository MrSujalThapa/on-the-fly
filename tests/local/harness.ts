import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { enableEditMode, reloadAndWaitForReplay, save } from "../e2e/helpers/actions.js";
import {
  applyOpacityFromToolbar,
  armLassoFromToolbar,
  createKindFromToolbar,
  invokeLayerCommand,
} from "../e2e/helpers/chrome-ui.js";
import { getOverlayRect, rect, type GeometryRect } from "../e2e/helpers/geometry.js";
import {
  assertCleanEditorState,
  auditIdentity,
  clearPageOperations,
  expectIdentityClean,
  loadSanitizedOperations,
  readRuntimeDiagnostics,
  settleVisual,
  unionRect,
  waitManagedStableZero,
  type RuntimeDiagnostics,
} from "../e2e/helpers/runtime-state.js";
import { captureOracle, dragHandle, type VisualOracle } from "../e2e/helpers/visual-oracle.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DIST_DIR = join(ROOT, "dist");
export const FIXTURE_URL = "http://127.0.0.1:4188/runtime/";

type WorkerFixtures = { persistentContext: BrowserContext };
type TestFixtures = { context: BrowserContext; page: Page };

/**
 * One long-running Chromium session with the built extension loaded. Worker
 * scope on purpose: long operation histories and repeated reloads are the point
 * of this suite, so the browser and its profile must survive across cases.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  persistentContext: [
    // Playwright requires object destructuring even when no fixtures are used.
    // eslint-disable-next-line no-empty-pattern -- required by Playwright fixture API
    async ({}, use) => {
      const headless = process.env.OTF_LOCAL_HEADED !== "1";
      const userDataDir = mkdtempSync(join(tmpdir(), "otf-local-"));
      const args = [
        `--disable-extensions-except=${DIST_DIR}`,
        `--load-extension=${DIST_DIR}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate,MediaRouter",
      ];
      if (headless) args.unshift("--headless=new");
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args,
        ignoreDefaultArgs: ["--disable-extensions"],
        viewport: { width: 1440, height: 900 },
      });
      if (context.serviceWorkers().length === 0) {
        await context.waitForEvent("serviceworker", { timeout: 30_000 });
      }
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
    attachRuntimeLog(page);
    await use(page);
  },
});

const RUNTIME_LOG: string[] = [];
const LOGGED_PAGES = new WeakSet<Page>();

function attachRuntimeLog(page: Page): void {
  if (LOGGED_PAGES.has(page)) return;
  LOGGED_PAGES.add(page);
  page.on("console", (message) => {
    const text = message.text();
    if (!text.startsWith("[otf-v2]")) return;
    RUNTIME_LOG.push(text);
    if (RUNTIME_LOG.length > 600) RUNTIME_LOG.splice(0, RUNTIME_LOG.length - 600);
  });
}

export function clearRuntimeLog(): void {
  RUNTIME_LOG.length = 0;
}

/** The runtime's own diagnostics trace, newest last. */
export function runtimeLogTail(count = 10): string[] {
  return RUNTIME_LOG.slice(-count);
}

export { expect };

export function productFailure(message: string): string {
  const trace = runtimeLogTail(8);
  const suffix = trace.length > 0 ? `\nruntime trace:\n${trace.join("\n")}` : "";
  return `PRODUCT FAILURE: ${message}${suffix}`;
}

export function harnessFailure(message: string): string {
  return `HARNESS FAILURE: ${message}`;
}

export const FIXTURE_TARGETS = [
  "pill-alpha",
  "pill-beta",
  "pill-gamma",
  "pill-delta",
  "profile",
  "card-one",
  "card-two",
  "nested",
  "auto-width",
  "min-content",
  "flex-grow",
  "relative",
  "pre-transformed",
  "stacked-low",
  "stacked-high",
  "overflow-child",
] as const;

export type FixtureTarget = (typeof FIXTURE_TARGETS)[number];

export type MutationKind =
  | "replace-subtree"
  | "remove-reinsert"
  | "add-sibling"
  | "remove-sibling"
  | "rerender-row"
  | "reflow-siblings"
  | "churn-cards";

export function fx(page: Page, target: FixtureTarget): Locator {
  return page.locator(`[data-fx="${target}"]`).first();
}

export async function openFixture(page: Page): Promise<void> {
  await page.goto(FIXTURE_URL, { waitUntil: "domcontentloaded" });
  await page.locator("#pill-nav").waitFor({ state: "visible" });
}

/**
 * Establishes the clean baseline a behavioural case must start from: no
 * persisted operations, no runtime-owned DOM state, edit mode live.
 */
export async function startCase(context: BrowserContext, page: Page, label: string): Promise<void> {
  // Clearing persisted operations while the page is parked on about:blank means
  // the fixture load that follows has nothing to replay, so no long
  // wait-for-quiet loop is needed to prove the baseline is unmodified.
  clearRuntimeLog();
  await page.goto("about:blank", { waitUntil: "domcontentloaded" });
  await clearPageOperations(context, page);
  await openFixture(page);
  await settleVisual(page);
  await enableEditMode(context, page);
  if (!(await waitManagedStableZero(page, 300))) {
    throw new Error(harnessFailure(`${label}: replay applied persisted transforms after enabling edit mode`));
  }
  await assertCleanEditorState(context, page, label);
}

export async function applyMutation(page: Page, kind: MutationKind): Promise<void> {
  const applied = await page.evaluate((mutation) => {
    const api = (window as unknown as { __fx?: Record<string, (name?: string) => boolean> }).__fx;
    if (!api) return false;
    const fn = {
      "replace-subtree": () => api.replaceSubtree?.("card-two"),
      "remove-reinsert": () => api.removeReinsert?.("pill-beta"),
      "add-sibling": () => api.addSibling?.(),
      "remove-sibling": () => api.removeSibling?.(),
      "rerender-row": () => api.rerenderRow?.(),
      "reflow-siblings": () => api.reflowSiblings?.(),
      "churn-cards": () => api.churnCards?.(),
    }[mutation];
    return Boolean(fn());
  }, kind);
  if (!applied) {
    throw new Error(harnessFailure(`fixture mutation ${kind} did not apply`));
  }
  await settleVisual(page);
  await page.waitForTimeout(120);
}

interface ClickPoint {
  x: number;
  y: number;
  ownership: "direct" | "descendant" | "none";
  topmost: string;
}

/**
 * A pointer assertion only proves something when the intended element really is
 * topmost at the chosen point. Elements promoted to independent placement paint
 * above the row they left, so a geometric centre is not automatically usable.
 */
async function resolveClickPoint(target: Locator): Promise<ClickPoint | null> {
  return target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return null;
    const fractions = [0.5, 0.3, 0.7, 0.2, 0.8, 0.12, 0.88];
    let fallback: ClickPoint | null = null;
    for (const fx of fractions) {
      for (const fy of fractions) {
        const x = box.x + box.width * fx;
        const y = box.y + box.height * fy;
        if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
        const stack = document.elementsFromPoint(x, y).filter(
          (node) => !(node instanceof HTMLElement) || !node.closest("#on-the-fly-root-host"),
        );
        const top = stack[0];
        if (!top) continue;
        const topmost = top instanceof HTMLElement ? top.tagName.toLowerCase() : "unknown";
        if (top === element) return { x, y, ownership: "direct", topmost };
        if (element.contains(top)) {
          fallback ??= { x, y, ownership: "descendant", topmost };
        }
      }
    }
    return fallback ?? {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      ownership: "none",
      topmost: "occluded",
    };
  });
}

export interface SelectOutcome {
  ownership: "direct" | "descendant" | "none";
  overlay: GeometryRect;
}

/**
 * Selects through a real pointer click and proves the runtime bound the element
 * the pointer actually landed on.
 */
export async function selectTarget(page: Page, target: Locator, label: string): Promise<SelectOutcome> {
  await target.scrollIntoViewIfNeeded().catch(() => undefined);
  const point = await resolveClickPoint(target);
  if (!point) throw new Error(harnessFailure(`${label}: target has no measurable box`));
  if (point.ownership === "none") {
    throw new Error(harnessFailure(`${label}: target fully occluded by ${point.topmost}`));
  }
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => getOverlayRect(page), { timeout: 8_000 }).not.toBeNull();
  const overlay = await getOverlayRect(page);
  if (!overlay) throw new Error(productFailure(`${label}: selection produced no overlay`));
  const covers = await page.evaluate(
    ({ px, py, ox, oy, ow, oh }) => {
      const inside = px >= ox - 2 && px <= ox + ow + 2 && py >= oy - 2 && py <= oy + oh + 2;
      return { inside };
    },
    { px: point.x, py: point.y, ox: overlay.x, oy: overlay.y, ow: overlay.width, oh: overlay.height },
  );
  if (!covers.inside) {
    const diag = await readRuntimeDiagnostics(page);
    throw new Error(
      productFailure(
        `${label}: selection did not follow the pointer click=(${point.x.toFixed(1)},${point.y.toFixed(1)}) overlay=${JSON.stringify(overlay)} pick=${JSON.stringify(diag?.lastPick)}`,
      ),
    );
  }
  await assertSelectionHasBox(page, label);
  return { ownership: point.ownership, overlay };
}

export async function addToSelection(page: Page, target: Locator, label: string): Promise<void> {
  const before = (await readRuntimeDiagnostics(page))?.selection.length ?? 0;
  const point = await resolveClickPoint(target);
  if (!point || point.ownership === "none") {
    throw new Error(harnessFailure(`${label}: shift-select target unusable`));
  }
  const box = await target.boundingBox();
  if (!box) throw new Error(harnessFailure(`${label}: shift-select target has no box`));
  await target.click({
    modifiers: ["Shift"],
    position: { x: point.x - box.x, y: point.y - box.y },
    force: true,
  });
  await expect
    .poll(async () => (await readRuntimeDiagnostics(page))?.selection.length ?? 0, { timeout: 8_000 })
    .toBeGreaterThan(before);
  await assertSelectionHasBox(page, label);
}

/**
 * A `display: contents` node or any other boxless element must never become the
 * selected visual target.
 */
export async function assertSelectionHasBox(page: Page, label: string): Promise<void> {
  const diag = await readRuntimeDiagnostics(page);
  for (const detail of diag?.selectionDetail ?? []) {
    if (!detail.bound) {
      throw new Error(productFailure(`${label}: selected node ${detail.nodeId} is not bound to a live element`));
    }
    const size = detail.rect;
    if (size && (size[2] <= 0 || size[3] <= 0)) {
      throw new Error(
        productFailure(`${label}: selected node ${detail.nodeId} has no visual box (${String(size[2])}x${String(size[3])})`),
      );
    }
  }
}

/** Overlay geometry must be derived from the live member rects, never cached. */
export async function assertOverlayMatchesMembers(page: Page, label: string): Promise<void> {
  const mismatch = async (): Promise<string | null> => {
    const diag = await readRuntimeDiagnostics(page);
    const overlay = await getOverlayRect(page);
    const rects = (diag?.selectionDetail ?? [])
      .map((detail) => detail.rect)
      .filter((value): value is [number, number, number, number] => Array.isArray(value));
    if (!overlay || rects.length === 0) return null;
    const members = rects.map(([x, y, width, height]) => ({
      x,
      y,
      width,
      height,
      top: y,
      left: x,
      right: x + width,
      bottom: y + height,
    }));
    const union = unionRect(members);
    const drift = Math.max(
      Math.abs(union.x - overlay.x),
      Math.abs(union.y - overlay.y),
      Math.abs(union.width - overlay.width),
      Math.abs(union.height - overlay.height),
    );
    if (drift <= 6) return null;
    return `overlay diverged from member rects overlay=${JSON.stringify(overlay)} union=${JSON.stringify(union)}`;
  };
  const first = await mismatch();
  if (!first) return;
  try {
    await expect.poll(async () => mismatch(), { timeout: 2_000 }).toBeNull();
  } catch {
    throw new Error(productFailure(`${label}: ${(await mismatch()) ?? first}`));
  }
}

export async function assertFiniteOverlay(page: Page, label: string): Promise<GeometryRect> {
  const overlay = await getOverlayRect(page);
  if (!overlay) throw new Error(productFailure(`${label}: overlay missing`));
  const values = [overlay.x, overlay.y, overlay.width, overlay.height];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(productFailure(`${label}: overlay rect not finite ${JSON.stringify(overlay)}`));
  }
  if (overlay.width <= 0 || overlay.height <= 0) {
    throw new Error(productFailure(`${label}: overlay collapsed ${String(overlay.width)}x${String(overlay.height)}`));
  }
  return overlay;
}

/**
 * A move gesture has to start on a selected member. The centre of a
 * multi-member overlay is often empty page, where a pointer press starts a new
 * lasso instead of dragging the current one.
 */
async function dragOrigin(page: Page, overlay: GeometryRect): Promise<{ x: number; y: number }> {
  const diag = await readRuntimeDiagnostics(page);
  const members = (diag?.selectionDetail ?? [])
    .map((detail) => detail.rect)
    .filter((value): value is [number, number, number, number] => Array.isArray(value))
    .filter(([, , width, height]) => width > 2 && height > 2)
    .sort((a, b) => b[2] * b[3] - a[2] * a[3]);
  const probed = await page.evaluate(
    ({ members }) => {
      const fractions = [0.5, 0.35, 0.65, 0.25, 0.75, 0.2, 0.8, 0.12, 0.88];
      const insideMember = (x: number, y: number): boolean =>
        members.some((member) => {
          const mx = member[0];
          const my = member[1];
          const mw = member[2];
          const mh = member[3];
          if (mx === undefined || my === undefined || mw === undefined || mh === undefined) return false;
          return x >= mx + 2 && x <= mx + mw - 2 && y >= my + 2 && y <= my + mh - 2;
        });
      const clearOfChrome = (x: number, y: number): boolean => {
        const stack = document.elementsFromPoint(x, y);
        const top = stack.find((node) => {
          if (!(node instanceof HTMLElement)) return false;
          if (node.closest("#on-the-fly-root-host")) return false;
          if (node.classList.contains("otf-transform-handle") || node.classList.contains("otf-crop-handle")) {
            return false;
          }
          return true;
        });
        return Boolean(top);
      };
      for (const member of members) {
        const mx = member[0];
        const my = member[1];
        const mw = member[2];
        const mh = member[3];
        if (mx === undefined || my === undefined || mw === undefined || mh === undefined) continue;
        for (const fx of fractions) {
          for (const fy of fractions) {
            const x = mx + mw * fx;
            const y = my + mh * fy;
            if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
            if (insideMember(x, y) && clearOfChrome(x, y)) return { x, y };
          }
        }
      }
      return null;
    },
    { members: members.length > 0 ? members : [[overlay.x, overlay.y, overlay.width, overlay.height]] },
  );
  if (probed) return probed;
  const largest = members[0];
  if (largest) {
    return { x: largest[0] + largest[2] * 0.5, y: largest[1] + largest[3] * 0.5 };
  }
  return { x: overlay.x + overlay.width / 2, y: overlay.y + overlay.height / 2 };
}

export async function moveSelection(
  page: Page,
  dx: number,
  dy: number,
  label: string,
  target?: Locator | null,
): Promise<{ before: GeometryRect; after: GeometryRect }> {
  const before = await assertFiniteOverlay(page, `${label} move-before`);
  let origin = await dragOrigin(page, before);
  if (target) {
    const point = await resolveClickPoint(target);
    if (point && point.ownership !== "none") origin = { x: point.x, y: point.y };
  }
  const { x, y } = origin;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 14 });
  await page.mouse.up();
  await settleVisual(page);
  const after = await assertFiniteOverlay(page, `${label} move-after`);
  const movedX = after.x + after.width / 2 - (before.x + before.width / 2);
  const movedY = after.y + after.height / 2 - (before.y + before.height / 2);
  if (Math.abs(dx) >= 60 || Math.abs(dy) >= 60) {
    // A large drag proves the MOVE delta is applied on world axes rather than
    // the target's rotated local axes.
    if (Math.abs(movedX - dx) > 36 || Math.abs(movedY - dy) > 36) {
      throw new Error(
        productFailure(
          `${label}: move used the wrong axes requested=(${String(dx)},${String(dy)}) applied=(${movedX.toFixed(1)},${movedY.toFixed(1)})`,
        ),
      );
    }
  } else if (Math.hypot(movedX, movedY) < 5) {
    throw new Error(
      productFailure(`${label}: move did nothing applied=(${movedX.toFixed(1)},${movedY.toFixed(1)})`),
    );
  }
  // Size must survive a move.
  if (Math.abs(after.width - before.width) > 6 || Math.abs(after.height - before.height) > 6) {
    throw new Error(
      productFailure(
        `${label}: move changed size ${before.width.toFixed(1)}x${before.height.toFixed(1)} -> ${after.width.toFixed(1)}x${after.height.toFixed(1)}`,
      ),
    );
  }
  return { before, after };
}

export async function resizeSelection(
  page: Page,
  dx: number,
  dy: number,
  label: string,
  handle = "resize-se",
): Promise<void> {
  const before = await assertFiniteOverlay(page, `${label} resize-before`);
  const dragged = await dragHandle(page, handle, dx, dy);
  if (!dragged) throw new Error(productFailure(`${label}: ${handle} handle missing`));
  await settleVisual(page);
  const after = await assertFiniteOverlay(page, `${label} resize-after`);
  if (Math.hypot(after.width - before.width, after.height - before.height) < 4) {
    throw new Error(
      productFailure(
        `${label}: resize snapback/no-op ${before.width.toFixed(1)}x${before.height.toFixed(1)} -> ${after.width.toFixed(1)}x${after.height.toFixed(1)}`,
      ),
    );
  }
  await page.waitForTimeout(220);
  const settled = await assertFiniteOverlay(page, `${label} resize-settled`);
  if (Math.hypot(settled.width - after.width, settled.height - after.height) > 8) {
    throw new Error(
      productFailure(
        `${label}: resize reverted after settle ${after.width.toFixed(1)}x${after.height.toFixed(1)} -> ${settled.width.toFixed(1)}x${settled.height.toFixed(1)}`,
      ),
    );
  }
}

export async function rotateSelection(
  page: Page,
  dx: number,
  dy: number,
  label: string,
  target?: Locator | null,
): Promise<void> {
  const beforeAngle = target ? await storedRotation(target) : null;
  const before = await assertFiniteOverlay(page, `${label} rotate-before`);
  const dragged = await dragHandle(page, "rotate", dx, dy);
  if (!dragged) throw new Error(productFailure(`${label}: rotate handle missing`));
  await settleVisual(page);
  const after = await assertFiniteOverlay(page, `${label} rotate-after`);
  const afterAngle = target ? await storedRotation(target) : null;
  const angleChanged = afterAngle !== null && Math.abs(afterAngle - (beforeAngle ?? 0)) >= 2;
  const aabbChanged = Math.hypot(after.width - before.width, after.height - before.height) >= 3;
  if (!angleChanged && !aabbChanged) {
    throw new Error(
      productFailure(
        `${label}: rotate did nothing angle=${String(beforeAngle)}->${String(afterAngle)} aabb=${before.width.toFixed(1)}x${before.height.toFixed(1)}->${after.width.toFixed(1)}x${after.height.toFixed(1)}`,
      ),
    );
  }
}

export async function storedRotation(target: Locator): Promise<number | null> {
  return target
    .evaluate((element) => {
      const raw = element.getAttribute("data-otf-transform");
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { rotate?: number };
        return typeof parsed.rotate === "number" ? parsed.rotate : null;
      } catch {
        return null;
      }
    })
    .catch(() => null);
}

export async function storedLocalSize(target: Locator): Promise<{ width: number; height: number } | null> {
  return target
    .evaluate((element) => {
      const raw = element.getAttribute("data-otf-transform");
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { width?: number; height?: number };
        if (typeof parsed.width === "number" && typeof parsed.height === "number") {
          return { width: parsed.width, height: parsed.height };
        }
        return null;
      } catch {
        return null;
      }
    })
    .catch(() => null);
}

export async function layerSelection(page: Page, command: "front" | "back"): Promise<void> {
  await invokeLayerCommand(page, command);
  await settleVisual(page);
}

export async function styleSelection(page: Page, value = "0.7"): Promise<void> {
  await applyOpacityFromToolbar(page, value);
  await page.waitForTimeout(240);
  await settleVisual(page);
  await expect.poll(() => getOverlayRect(page), { timeout: 8_000 }).not.toBeNull();
}

export async function duplicateSelection(page: Page, label: string): Promise<{ locator: Locator; cloneId: string }> {
  const beforeIds = await liveCloneIds(page);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect
    .poll(async () => (await liveCloneIds(page)).length, { timeout: 8_000 })
    .toBeGreaterThan(beforeIds.length);
  const afterIds = await liveCloneIds(page);
  const created = afterIds.find((id) => !beforeIds.includes(id));
  if (!created) throw new Error(productFailure(`${label}: duplicate produced no new cloneId`));
  const locator = page.locator(`[data-otf-clone-id="${created}"]`).first();
  await expect(locator).toBeVisible();
  return { locator, cloneId: created };
}

export async function liveCloneIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-otf-clone-id]"))
      .map((element) => element.getAttribute("data-otf-clone-id") ?? "")
      .filter((value) => value.length > 0),
  );
}

export async function liveElementIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-otf-element-id]:not([data-otf-preview])"))
      .map((element) => element.getAttribute("data-otf-element-id") ?? "")
      .filter((value) => value.length > 0),
  );
}

export async function createFromPalette(
  page: Page,
  kind: string,
  x: number,
  y: number,
  label: string,
): Promise<{ locator: Locator; elementId: string }> {
  const before = await liveElementIds(page);
  await createKindFromToolbar(page, kind, x, y);
  await expect.poll(async () => (await liveElementIds(page)).length, { timeout: 8_000 }).toBeGreaterThan(before.length);
  const after = await liveElementIds(page);
  const created = after.find((id) => !before.includes(id));
  if (!created) throw new Error(productFailure(`${label}: create produced no new elementId`));
  const locator = page.locator(`[data-otf-element-id="${created}"]`).first();
  await expect(locator).toBeVisible();
  return { locator, elementId: created };
}

export async function lassoRegion(
  page: Page,
  mode: "rectangle" | "freeform",
  region: { x: number; y: number; width: number; height: number },
  arm = true,
): Promise<void> {
  if (arm) await armLassoFromToolbar(page, mode);
  const startX = region.x;
  const startY = region.y;
  const endX = region.x + region.width;
  const endY = region.y + region.height;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  if (mode === "rectangle") {
    await page.mouse.move(endX, endY, { steps: 10 });
  } else {
    await page.mouse.move(endX, startY, { steps: 5 });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.move(startX, endY, { steps: 5 });
    await page.mouse.move(startX, startY, { steps: 5 });
  }
  await page.mouse.up();
  await settleVisual(page);
}

/** The pill row bounds: a deterministic multi-member lasso region. */
export async function pillRowRegion(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  // Not scoped to #pill-nav: a pill promoted to independent placement leaves the
  // nav, and the lasso region must still cover where it now paints.
  const boxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-fx^="pill-"]')).map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }),
  );
  if (boxes.length === 0) throw new Error(harnessFailure("pill row has no measurable pills"));
  const left = Math.min(...boxes.map((box) => box.x)) - 14;
  const top = Math.min(...boxes.map((box) => box.y)) - 14;
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + 14;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 14;
  return { x: Math.max(2, left), y: Math.max(2, top), width: right - left, height: bottom - top };
}

export async function expectMultiSelection(page: Page, label: string, minimum = 2): Promise<void> {
  await expect
    .poll(async () => (await readRuntimeDiagnostics(page))?.selection.length ?? 0, { timeout: 8_000 })
    .toBeGreaterThanOrEqual(minimum);
  await assertFiniteOverlay(page, `${label} multi-overlay`);
  await assertOverlayMatchesMembers(page, label);
}

export async function saveEdits(page: Page, label: string): Promise<void> {
  const host = page.locator("#on-the-fly-root-host");
  await save(page);
  await expect.poll(async () => host.getAttribute("data-otf-save-status"), { timeout: 20_000 }).not.toBe("saving");
  const status = await host.getAttribute("data-otf-save-status");
  if (status === "failed") {
    throw new Error(productFailure(`${label}: save failed ${(await host.getAttribute("data-otf-save-error")) ?? ""}`));
  }
}

/** A save that must actually persist something; empty saves prove nothing. */
export async function saveNonEmpty(context: BrowserContext, page: Page, label: string): Promise<number> {
  await saveEdits(page, label);
  const stored = await loadSanitizedOperations(context, page);
  if (stored.length === 0) {
    throw new Error(productFailure(`${label}: save persisted zero operations`));
  }
  return stored.length;
}

export async function reloadAndReplay(page: Page): Promise<void> {
  await reloadAndWaitForReplay(page);
  await page.locator("main").waitFor({ state: "visible" });
}

async function releaseModifiers(page: Page): Promise<void> {
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await page.keyboard.up("Meta");
  await page.keyboard.up("Alt");
}

async function dispatchUndoRedo(page: Page, redo: boolean): Promise<void> {
  await releaseModifiers(page);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Shift",
      code: "ShiftLeft",
      windowsVirtualKeyCode: 16,
    });
    const key = redo ? "y" : "z";
    const windowsVirtualKeyCode = redo ? 89 : 90;
    await session.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      modifiers: 2,
      key,
      code: redo ? "KeyY" : "KeyZ",
      windowsVirtualKeyCode,
    });
    await session.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: redo ? "KeyY" : "KeyZ",
      windowsVirtualKeyCode,
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

export async function undo(page: Page): Promise<void> {
  await dispatchUndoRedo(page, false);
  await settleVisual(page);
}

export async function redo(page: Page): Promise<void> {
  await dispatchUndoRedo(page, true);
  await settleVisual(page);
}

export async function group(page: Page): Promise<void> {
  await page.keyboard.press("Control+g");
  await settleVisual(page);
}

export async function ungroup(page: Page): Promise<void> {
  await page.keyboard.press("Control+Shift+g");
  await settleVisual(page);
}

export async function deleteSelection(page: Page, doomed: Locator | null, label: string): Promise<void> {
  const diag = await readRuntimeDiagnostics(page);
  const selectedRects = (diag?.selectionDetail ?? [])
    .map((detail) => detail.rect)
    .filter((value): value is [number, number, number, number] => Array.isArray(value));
  const selectedHosts = await page.evaluate((rects) => {
    const names: string[] = [];
    for (const element of Array.from(document.querySelectorAll("[data-fx]"))) {
      if (!(element instanceof HTMLElement)) continue;
      const name = element.getAttribute("data-fx");
      if (!name) continue;
      const box = element.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      if (rects.some(([x, y, width, height]) => cx >= x - 4 && cx <= x + width + 4 && cy >= y - 4 && cy <= y + height + 4)) {
        names.push(name);
      }
    }
    return names;
  }, selectedRects);
  const doomedName = doomed
    ? await doomed.evaluate((element) => element.getAttribute("data-fx")).catch(() => null)
    : null;
  const expectedGone = new Set(selectedHosts);
  if (doomedName) expectedGone.add(doomedName);
  const before = await siblingGeometry(page);
  await page.keyboard.press("Delete");
  await settleVisual(page);
  if (doomed) {
    const visible = await doomed.isVisible().catch(() => false);
    if (visible) throw new Error(productFailure(`${label}: deleted identity still visible immediately`));
  }
  const after = await siblingGeometry(page);
  const vanished: string[] = [];
  for (const [key, prior] of Object.entries(before)) {
    if (expectedGone.has(key)) continue;
    const next = after[key];
    if (!next || next.width < 1 || next.height < 1) {
      vanished.push(key);
      continue;
    }
    if (Math.abs(next.width - prior.width) > 24 || Math.abs(next.height - prior.height) > 24) {
      throw new Error(
        productFailure(
          `${label}: delete resized unrelated element ${key} ${prior.width.toFixed(1)}x${prior.height.toFixed(1)} -> ${next.width.toFixed(1)}x${next.height.toFixed(1)}`,
        ),
      );
    }
  }
  if (vanished.length > 0) {
    throw new Error(
      productFailure(
        `${label}: delete removed unrelated elements (${vanished.join(",")})`,
      ),
    );
  }
}

async function siblingGeometry(page: Page): Promise<Record<string, { width: number; height: number }>> {
  return page.evaluate(() => {
    const out: Record<string, { width: number; height: number }> = {};
    for (const element of Array.from(document.querySelectorAll("[data-fx]"))) {
      const name = element.getAttribute("data-fx");
      if (!name) continue;
      const box = element.getBoundingClientRect();
      out[name] = { width: box.width, height: box.height };
    }
    return out;
  });
}

export async function oracleFor(page: Page, target: Locator): Promise<VisualOracle> {
  return captureOracle(page, target);
}

export async function targetRect(target: Locator): Promise<GeometryRect> {
  return rect(target);
}

/**
 * The per-operation invariant gate. Runs after every step of every scenario.
 */
export async function assertInvariants(page: Page, label: string): Promise<void> {
  expectIdentityClean(await auditIdentity(page), label);
  const diag = await readRuntimeDiagnostics(page);
  if (!diag) throw new Error(harnessFailure(`${label}: runtime diagnostics unavailable`));
  if (diag.selection.length > 0) {
    await assertFiniteOverlay(page, label);
    await assertSelectionHasBox(page, label);
    await assertOverlayMatchesMembers(page, label);
  }
  const stale = diag.reapply.filter((entry) => entry.session !== diag.session);
  if (stale.length > 0) {
    throw new Error(productFailure(`${label}: reapply ran for a stale session ${JSON.stringify(stale.slice(0, 3))}`));
  }
}

export async function diagnostics(page: Page): Promise<RuntimeDiagnostics> {
  const diag = await readRuntimeDiagnostics(page);
  if (!diag) throw new Error(harnessFailure("runtime diagnostics unavailable"));
  return diag;
}
