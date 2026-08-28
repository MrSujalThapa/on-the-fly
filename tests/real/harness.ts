import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test as base, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { enableEditMode, reloadAndWaitForReplay, save } from "../e2e/helpers/actions.js";
import { dismissJumpMenu } from "../e2e/helpers/chrome-ui.js";
import {
  assertCleanEditorState,
  auditIdentity,
  clearPageOperations,
  expectIdentityClean,
  loadSanitizedOperations,
  nearRect,
  readRuntimeDiagnostics,
  rectDelta,
  resetPersistedPage,
  resetRuntimeSession,
  sanitizeOperations,
  settleVisual,
  unionRect,
  waitManagedStableZero,
  type IdentityAudit,
  type RuntimeDiagnostics,
  type RuntimeResetResult,
} from "../e2e/helpers/runtime-state.js";
import {
  getIndicatorMode,
  getOverlayPipeline,
  getOverlayRect,
  rect,
  waitForReplaySettle,
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

async function liveBox(
  target: Locator,
  label: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect
    .poll(
      async () => {
        const box = await target.boundingBox().catch(() => null);
        if (!box || box.width < 2 || box.height < 2) {
          return null;
        }
        return box;
      },
      { timeout: 20_000 },
    )
    .not.toBeNull();
  const box = await target.boundingBox();
  expect(box, productFailure(label)).not.toBeNull();
  if (!box) {
    throw new Error(productFailure(label));
  }
  return box;
}

export { dismissJumpMenu };

export {
  assertCleanEditorState,
  auditIdentity,
  clearPageOperations,
  expectIdentityClean,
  loadSanitizedOperations,
  nearRect,
  readRuntimeDiagnostics,
  rectDelta,
  resetPersistedPage,
  resetRuntimeSession,
  sanitizeOperations,
  settleVisual,
  unionRect,
  type IdentityAudit,
  type RuntimeDiagnostics,
  type RuntimeResetResult,
};

function jumpMenuBlocksPoint(page: Page, x: number, y: number): Promise<boolean> {
  return page.evaluate(({ px, py }) => {
    const hit = document.elementFromPoint(px, py);
    if (!(hit instanceof Element)) {
      return false;
    }
    const text = `${hit.getAttribute("aria-label") ?? ""} ${hit.textContent ?? ""}`;
    return /jump menu|skip to /i.test(text);
  }, { px: x, py: y });
}

export interface ClickPointProbe {
  x: number;
  y: number;
  occludedBy: string | null;
  stack: string[];
  ownership: "direct" | "descendant" | "none";
}

/**
 * A pointer test only proves anything when the target is the topmost paintable
 * element at the click point. Elements promoted to independent placement paint
 * above the reflowed row they left, so the geometric centre of a sibling is not
 * always a usable click point. Probe the target's own box for a point it
 * actually owns and report the occluder when it owns none.
 */
async function resolveClickPoint(target: Locator): Promise<ClickPointProbe | null> {
  return target.evaluate((element) => {
    const describe = (node: Element): string => {
      const html = node instanceof HTMLElement ? node : null;
      const text = (html?.innerText ?? node.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 24);
      return `${node.tagName.toLowerCase()}${html?.id ? `#${html.id}` : ""}:${text}`;
    };
    const ownsPoint = (px: number, py: number): { owns: "direct" | "descendant" | false; stack: string[]; blocker: string | null } => {
      const path = document.elementsFromPoint(px, py);
      const stack = path.slice(0, 6).map(describe);
      for (const node of path) {
        if (node instanceof HTMLElement && node.closest("#on-the-fly-root-host")) continue;
        if (node === element) {
          return { owns: "direct", stack, blocker: null };
        }
        if (element.contains(node)) {
          return { owns: "descendant", stack, blocker: null };
        }
        return { owns: false, stack, blocker: describe(node) };
      }
      return { owns: false, stack, blocker: null };
    };
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return null;
    const candidates: Array<{ x: number; y: number }> = [
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    ];
    for (const fx of [0.5, 0.75, 0.25, 0.9, 0.1]) {
      for (const fy of [0.5, 0.7, 0.3, 0.85, 0.15]) {
        candidates.push({ x: box.x + box.width * fx, y: box.y + box.height * fy });
      }
    }
    let firstBlocked: { stack: string[]; blocker: string | null } | null = null;
    let firstPoint: { x: number; y: number } | null = null;
    for (const point of candidates) {
      if (point.x < 1 || point.y < 1 || point.x > window.innerWidth - 1 || point.y > window.innerHeight - 1) continue;
      const probe = ownsPoint(point.x, point.y);
      // Runtime V2 selects exactly the topmost element under the pointer. Report
      // whether the point belongs to the target itself or only to a descendant so
      // callers know which element the runtime is expected to select.
      if (probe.owns !== false) {
        return { x: point.x, y: point.y, occludedBy: null, stack: probe.stack, ownership: probe.owns };
      }
      firstBlocked ??= probe;
      firstPoint ??= point;
    }
    return {
      x: firstPoint?.x ?? box.x + box.width / 2,
      y: firstPoint?.y ?? box.y + box.height / 2,
      occludedBy: firstBlocked?.blocker ?? "unknown",
      stack: firstBlocked?.stack ?? [],
      ownership: "none",
    };
  });
}

function writeSelectProbe(payload: Record<string, unknown>): void {
  mkdirSync(join(REAL_ARTIFACT_DIR, "runs"), { recursive: true });
  writeFileSync(
    join(REAL_ARTIFACT_DIR, "runs", "select-t0.json"),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

export interface SelectOutcome {
  /**
   * "direct" means the pointer landed on the target's own box, so the runtime is
   * expected to select the target itself. "descendant" means the target only owns
   * the point through a child, so the runtime is expected to select that child.
   */
  readonly ownership: "direct" | "descendant";
}

export async function selectRealTarget(page: Page, target: Locator): Promise<SelectOutcome> {
  const box = await liveBox(target, "target bounding box missing");
  if (await jumpMenuBlocksPoint(page, box.x + box.width / 2, box.y + box.height / 2)) {
    await dismissJumpMenu(page);
  }
  const live = await liveBox(target, "target bounding box missing after jump-menu dismiss");
  const probe = await resolveClickPoint(target);
  if (!probe) {
    throw new Error("HARNESS FAILURE: target has no measurable box to click");
  }
  const x = probe.x;
  const y = probe.y;
  const beforeHit = { hits: probe.occludedBy === null, stack: probe.stack, occludedBy: probe.occludedBy };
  const beforeSurface = await page.evaluate(() => {
    const nav = Array.from(document.querySelectorAll("main nav")).find((node) => /Mentions/i.test(node.textContent ?? ""));
    return {
      navText: (nav?.textContent ?? "").replace(/\s+/gu, " ").slice(0, 80),
      managed: Array.from(document.querySelectorAll("[data-otf-managed],[data-otf-transform],[data-otf-detached]")).length,
    };
  }).catch(() => null);
  const storedOps = await loadSanitizedOperations(page.context(), page).catch(() => []);
  if (!beforeHit.hits) {
    const retry = await page.evaluate(({ px, py }) => {
      const path = document.elementsFromPoint(px, py);
      const usable = path.find((node): node is HTMLElement =>
        node instanceof HTMLElement && !node.closest("#on-the-fly-root-host") && node.getBoundingClientRect().width >= 8,
      );
      if (!usable) {
        return null;
      }
      const next = usable.getBoundingClientRect();
      return { x: next.x + next.width / 2, y: next.y + next.height / 2, tag: usable.tagName, text: (usable.innerText ?? "").replace(/\s+/gu, " ").slice(0, 48) };
    }, { px: x, py: y });
    writeSelectProbe({
      classification: "B",
      reason: "locator center did not hit the live target",
      locator: live,
      click: { x, y },
      beforeHit,
      beforeSurface,
      storedOps: storedOps.length,
      retry,
    });
    throw new Error(
      `HARNESS FAILURE: target is fully occluded at every probed point by ${String(beforeHit.occludedBy)} stack=${JSON.stringify(beforeHit.stack)}`,
    );
  }
  await page.mouse.move(x, y, { steps: 1 });
  await page.mouse.down();
  await page.mouse.up();
  const t0Overlay = await getOverlayRect(page);
  const t0Pipeline = await getOverlayPipeline(page);
  const t0Mode = await getIndicatorMode(page);
  const t0Dom = await page.evaluate(({ px, py }) => {
    const host = document.getElementById("on-the-fly-root-host");
    const hits = document.elementsFromPoint(px, py).slice(0, 6).map((node) => ({
      tag: node instanceof HTMLElement ? node.tagName : node.nodeName,
      id: node instanceof HTMLElement ? node.id : "",
      text: (node instanceof HTMLElement ? node.innerText : "").replace(/\s+/gu, " ").slice(0, 48),
    }));
    return {
      hits,
      hasHost: Boolean(host),
      hostEvents: host instanceof HTMLElement ? host.style.pointerEvents : null,
      armed: host?.getAttribute("data-otf-placement-armed") ?? null,
      save: host?.getAttribute("data-otf-save-status") ?? null,
      managed: Array.from(document.querySelectorAll("[data-otf-managed],[data-otf-transform],[data-otf-detached]")).slice(0, 8).map((node) => {
        const html = node as HTMLElement;
        return {
          text: (html.innerText ?? "").replace(/\s+/gu, " ").slice(0, 32),
          managed: html.getAttribute("data-otf-managed"),
          detached: html.getAttribute("data-otf-detached"),
          transform: (html.getAttribute("data-otf-transform") ?? "").slice(0, 80),
        };
      }),
    };
  }, { px: x, py: y }).catch(() => null);
  writeSelectProbe({
    click: { x, y, box: live },
    beforeHit,
    beforeSurface,
    storedOps: storedOps.length,
    t0: { overlay: t0Overlay, pipeline: t0Pipeline, mode: t0Mode, dom: t0Dom },
  });
  try {
    await expect
      .poll(async () => getOverlayRect(page), { timeout: 8_000 })
      .not.toBeNull();
  } catch (error) {
    throw new Error(`${String(error)}\nselect debug: ${JSON.stringify({ click: { x, y }, beforeHit, beforeSurface, storedOps: storedOps.length, t0Overlay, t0Pipeline, t0Mode, t0Dom })}`);
  }
  const overlay = await getOverlayRect(page);
  if (overlay && (overlay.width > live.width * 4 || overlay.height > live.height * 4) && overlay.width > 240) {
    throw new Error(productFailure(`selection overlay promoted beyond the clicked object overlay=${overlay.width.toFixed(1)}x${overlay.height.toFixed(1)} target=${live.width.toFixed(1)}x${live.height.toFixed(1)}`));
  }
  const diag = await readRuntimeDiagnostics(page);
  const unbound = diag?.selectionDetail.filter((row) => !row.bound) ?? [];
  if (unbound.length > 0) {
    throw new Error(productFailure(`selection holds unresolvable nodes ${JSON.stringify(unbound)}`));
  }
  const detail = diag?.selectionDetail ?? [];
  if (detail.length === 1) {
    const selected = detail[0]?.rect;
    if (selected) {
      const [sx, sy, sw, sh] = selected;
      const insideSelected = x >= sx - 2 && x <= sx + sw + 2 && y >= sy - 2 && y <= sy + sh + 2;
      if (!insideSelected) {
        throw new Error(productFailure(
          `selection did not follow the pointer click=(${x.toFixed(1)},${y.toFixed(1)}) selected=${JSON.stringify(detail[0])} pick=${JSON.stringify(diag?.lastPick)}`,
        ));
      }
    }
  }
  return { ownership: probe.ownership === "descendant" ? "descendant" : "direct" };
}

export async function dragRealTarget(page: Page, target: Locator, dx: number, dy: number): Promise<void> {
  const overlay = await getOverlayRect(page);
  const box = overlay ?? await liveBox(target, "drag target bounding box missing");
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
  const overlay = await getOverlayRect(page);
  const beforeBox = overlay ?? await liveBox(target, "move start box missing");
  const before: GeometryRect = {
    x: beforeBox.x,
    y: beforeBox.y,
    width: beforeBox.width,
    height: beforeBox.height,
    top: beforeBox.y,
    left: beforeBox.x,
    right: beforeBox.x + beforeBox.width,
    bottom: beforeBox.y + beforeBox.height,
  };
  await dragRealTarget(page, target, dx, dy);
  const afterOverlay = await getOverlayRect(page);
  const afterBox = afterOverlay ?? await liveBox(target, "move end box missing");
  const after: GeometryRect = {
    x: afterBox.x,
    y: afterBox.y,
    width: afterBox.width,
    height: afterBox.height,
    top: afterBox.y,
    left: afterBox.x,
    right: afterBox.x + afterBox.width,
    bottom: afterBox.y + afterBox.height,
  };
  return { before, after };
}

export async function saveReal(page: Page): Promise<void> {
  await save(page);
}

export async function reloadReplay(page: Page): Promise<void> {
  await reloadAndWaitForReplay(page);
}

export async function enableEdit(context: BrowserContext, page: Page): Promise<void> {
  const startClean = async (): Promise<void> => {
    await enableEditMode(context, page);
    if (await waitManagedStableZero(page, 6_000)) {
      return;
    }
    await clearPageOperations(context, page);
    await resetPersistedPage(context, page);
    await enableEditMode(context, page);
    if (!(await waitManagedStableZero(page, 6_000))) {
      throw new Error("HARNESS FAILURE: replay applied persisted transforms after enableEdit");
    }
  };
  await startClean();
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
  const filters = await page.evaluate(() => {
    const names = /^(All|Jobs|My posts|Mentions)\b/iu;
    return Array.from(document.querySelectorAll("a,button"))
      .filter((element) => names.test((element.textContent ?? "").trim()))
      .slice(0, 12)
      .map((element) => {
        const html = element as HTMLElement;
        return {
          text: (html.innerText ?? "").replace(/\s+/gu, " ").slice(0, 40),
          transform: html.style.transform,
          stored: html.getAttribute("data-otf-transform"),
          managed: html.getAttribute("data-otf-managed"),
        };
      });
  }).catch(() => []);
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
    filters,
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
