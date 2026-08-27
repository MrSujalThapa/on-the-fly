import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { getOverlayRect } from "../../e2e/helpers/geometry.js";
import { applyOpacityFromToolbar, armLassoFromToolbar, createKindFromToolbar, invokeLayerCommand } from "../chrome-ui.js";
import {
  attachFailureArtifacts,
  captureStepSnapshot,
  dragHandle,
} from "../oracles.js";
import {
  expect,
  productFailure,
  readRuntimeDiagnostics,
  saveReal,
  selectAndDragReal,
  selectRealTarget,
  settleVisual,
} from "../harness.js";
import { linkedInFilter, linkedInFilters, reloadLinkedInAndReplay } from "../linkedin.js";
import type { Scenario, Step, TargetName } from "./manifest.js";

export interface RunSession {
  source: Locator | null;
  clone: Locator | null;
  cloneId: string | null;
  created: Locator | null;
  createdId: string | null;
  lastSelected: Locator | null;
  deleted: Locator | null;
  createSlot: number;
}

function fail(caseId: string, step: number, op: string, message: string): Error {
  return new Error(productFailure(`${caseId} step ${String(step)} ${op}: ${message}`));
}

async function expectSave(page: Page): Promise<void> {
  await saveReal(page);
  const host = page.locator("#on-the-fly-root-host");
  await expect.poll(async () => host.getAttribute("data-otf-save-status")).not.toBe("saving");
  const status = await host.getAttribute("data-otf-save-status");
  if (status === "failed") throw new Error(`SAVE FAILED: ${await host.getAttribute("data-otf-save-error") ?? "unknown"}`);
}

async function notificationCard(page: Page): Promise<Locator> {
  const rundown = page.getByRole("main").getByText("Daily Rundown").first();
  if (await rundown.isVisible().catch(() => false)) return rundown;
  const heading = page.getByRole("heading", { name: "Manage your notifications" });
  if (await heading.isVisible().catch(() => false)) return heading;
  const article = page.getByRole("main").locator("article").filter({ hasText: /./u }).first();
  if (await article.isVisible().catch(() => false)) return article;
  const empty = page.getByRole("main").getByText("No notifications yet").first();
  if (await empty.isVisible().catch(() => false)) return empty;
  return page.getByRole("main").locator("article, section").filter({ hasText: /./u }).first();
}

async function profileSection(page: Page): Promise<Locator> {
  const sidebar = page.getByRole("complementary", { name: "Sidebar" }).or(page.getByRole("complementary"));
  const named = sidebar.locator("a[href*='/in/']").filter({ has: page.locator("p") });
  if (await named.first().isVisible().catch(() => false)) return named.first();
  return sidebar.locator("a[href*='/in/']").first();
}

async function resolveTarget(page: Page, session: RunSession, name: TargetName): Promise<Locator> {
  if (name === "mentions") return linkedInFilter(page, "Mentions");
  if (name === "jobs") return linkedInFilter(page, "Jobs");
  if (name === "posts") return linkedInFilter(page, "My posts");
  if (name === "all") return linkedInFilter(page, "All");
  if (name === "filter-bar") return linkedInFilter(page, "All");
  if (name === "profile") return profileSection(page);
  if (name === "notification") return notificationCard(page);
  if (name === "view-settings") return page.getByRole("link", { name: "View settings" });
  if (name === "clone") {
    if (!session.clone) throw new Error("clone target missing");
    return session.clone;
  }
  if (name === "created") {
    if (!session.created) throw new Error("created target missing");
    return session.created;
  }
  if (!session.source) throw new Error("source target missing");
  return session.source;
}

async function markSource(page: Page, target: Locator): Promise<void> {
  const overlay = await getOverlayRect(page);
  const box = overlay ?? await target.boundingBox();
  if (!box) return;
  await page.evaluate(({ x, y, width, height }) => {
    const marked = document.querySelectorAll("[data-otf-test-target='acceptance-source']");
    for (let index = 0; index < marked.length; index += 1) {
      marked.item(index)?.removeAttribute("data-otf-test-target");
    }
    const near = (rect: DOMRect): boolean =>
      Math.abs(rect.x - x) < 3 &&
      Math.abs(rect.y - y) < 3 &&
      Math.abs(rect.width - width) < 3 &&
      Math.abs(rect.height - height) < 3;
    const stack = document.elementsFromPoint(x + width / 2, y + height / 2);
    let chosen: HTMLElement | null = null;
    for (const node of stack) {
      if (!(node instanceof HTMLElement) || node.closest("#on-the-fly-root-host")) continue;
      if (near(node.getBoundingClientRect())) {
        chosen = node;
        break;
      }
    }
    if (!chosen) {
      const fallback = stack.find((node): node is HTMLElement =>
        node instanceof HTMLElement && !node.closest("#on-the-fly-root-host"));
      chosen = fallback ?? null;
    }
    chosen?.setAttribute("data-otf-test-target", "acceptance-source");
  }, box);
}

async function stampedTarget(page: Page): Promise<Locator | null> {
  const stamped = page.locator("[data-otf-test-target='acceptance-source']");
  if (await stamped.first().isVisible().catch(() => false)) return stamped.first();
  return null;
}

async function lassoGesture(page: Page, mode: "rectangle" | "freeform"): Promise<void> {
  // Always derive the lasso region from the live filter controls. Deriving it from
  // the current selection overlay makes the region depend on whatever the previous
  // operation happened to leave selected, which can shrink it to a single element.
  const filters = await linkedInFilters(page);
  const boxes = (await Promise.all([
    filters.All.boundingBox(),
    filters.Jobs.boundingBox(),
    filters["My posts"].boundingBox(),
    filters.Mentions.boundingBox(),
  ])).filter((box): box is NonNullable<typeof box> => Boolean(box));
  if (boxes.length === 0) throw new Error("filter bar boxes missing");
  const startX = Math.max(2, Math.min(...boxes.map((box) => box.x)) - 16);
  const startY = Math.max(2, Math.min(...boxes.map((box) => box.y)) - 16);
  const endX = Math.max(...boxes.map((box) => box.x + box.width)) + 16;
  const endY = Math.max(...boxes.map((box) => box.y + box.height)) + 16;
  if (mode === "rectangle") {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();
    return;
  }
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, startY, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 4 });
  await page.mouse.move(startX, endY, { steps: 4 });
  await page.mouse.move(startX, startY, { steps: 4 });
  await page.mouse.up();
}

async function lassoFilters(page: Page, mode: "rectangle" | "freeform"): Promise<void> {
  await armLassoFromToolbar(page, mode);
  await lassoGesture(page, mode);
}

/**
 * A lasso must produce its own multi-member selection. Polling only for a non-null
 * overlay passes on the selection left behind by the previous step.
 */
async function expectLassoSelection(page: Page, caseId: string, step: number): Promise<void> {
  await expect.poll(async () => (await readRuntimeDiagnostics(page))?.selection.length ?? 0).toBeGreaterThan(1);
  const overlay = await getOverlayRect(page);
  if (!overlay) throw fail(caseId, step, "lasso", "lasso selection produced no overlay");
}

async function assertMoved(page: Page, target: Locator, expectedDx: number, caseId: string, step: number, before: Awaited<ReturnType<typeof captureStepSnapshot>>): Promise<void> {
  await settleVisual(page);
  const after = await captureStepSnapshot(page, target);
  const dx = (after.oracle.rect.x + after.oracle.rect.width / 2) - (before.oracle.rect.x + before.oracle.rect.width / 2);
  const dy = (after.oracle.rect.y + after.oracle.rect.height / 2) - (before.oracle.rect.y + before.oracle.rect.height / 2);
  if (after.oracle.display === "none" || after.oracle.rect.width < 2) {
    throw fail(caseId, step, "move", "element disappeared");
  }
  if (Math.abs(expectedDx) >= 80) {
    if (Math.abs(dx - expectedDx) > 48 || Math.abs(dy) > 48) {
      throw fail(caseId, step, "move", `world-axis failed dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} expectedDx=${String(expectedDx)}`);
    }
  } else if (Math.hypot(dx, dy) < 6) {
    throw fail(caseId, step, "move", `no movement dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
  }
}

async function realizedLocal(oracle: { storedTransform: Record<string, unknown> | null; computedWidth: string; computedHeight: string; rect: { width: number; height: number } }): Promise<{ width: number; height: number }> {
  const storedW = Number(oracle.storedTransform?.width);
  const storedH = Number(oracle.storedTransform?.height);
  if (Number.isFinite(storedW) && storedW > 1 && Number.isFinite(storedH) && storedH > 1) {
    return { width: storedW, height: storedH };
  }
  const width = Number.parseFloat(oracle.computedWidth);
  const height = Number.parseFloat(oracle.computedHeight);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 1 && height > 1) {
    return { width, height };
  }
  return { width: oracle.rect.width, height: oracle.rect.height };
}

async function assertResized(page: Page, target: Locator, caseId: string, step: number, before: Awaited<ReturnType<typeof captureStepSnapshot>>): Promise<void> {
  await settleVisual(page);
  const after = await captureStepSnapshot(page, target);
  const startLocal = await realizedLocal(before.oracle);
  const afterLocal = await realizedLocal(after.oracle);
  const localDelta = Math.hypot(afterLocal.width - startLocal.width, afterLocal.height - startLocal.height);
  const aabbDelta = Math.hypot(after.oracle.rect.width - before.oracle.rect.width, after.oracle.rect.height - before.oracle.rect.height);
  if (localDelta < 4 && aabbDelta < 4) {
    throw fail(
      caseId,
      step,
      "resize",
      `snapback/no-op local=${startLocal.width.toFixed(1)}x${startLocal.height.toFixed(1)}→${afterLocal.width.toFixed(1)}x${afterLocal.height.toFixed(1)} aabb=${before.oracle.rect.width.toFixed(1)}→${after.oracle.rect.width.toFixed(1)}`,
    );
  }
  await page.waitForTimeout(500);
  const later = await captureStepSnapshot(page, target);
  const laterLocal = await realizedLocal(later.oracle);
  if (Math.hypot(laterLocal.width - afterLocal.width, laterLocal.height - afterLocal.height) > 8
    && Math.abs(later.oracle.rect.width - after.oracle.rect.width) > 8) {
    throw fail(caseId, step, "resize", "size reverted after 500ms");
  }
}

async function warmup(page: Page, count: number, session: RunSession): Promise<void> {
  const dirty = await page.evaluate(() =>
    document.querySelectorAll("[data-otf-managed],[data-otf-transform],[data-otf-detached]").length,
  ).catch(() => 0);
  if (dirty > 0) {
    throw new Error(`HARNESS FAILURE: warmup started on dirty editor surface managed=${String(dirty)}`);
  }
  const targets: TargetName[] = ["mentions", "jobs", "posts", "all"];
  for (let index = 0; index < count; index += 1) {
    const name = targets[index % targets.length];
    if (!name) continue;
    const target = await resolveTarget(page, session, name);
    if (index === 0) {
      const surface = await page.evaluate(() => ({
        managed: document.querySelectorAll("[data-otf-managed],[data-otf-transform],[data-otf-detached]").length,
        nav: (Array.from(document.querySelectorAll("main nav")).find((node) => /Mentions/i.test(node.textContent ?? ""))?.textContent ?? "").replace(/\s+/gu, " ").slice(0, 80),
      }));
      if (surface.managed > 0) {
        throw new Error(`HARNESS FAILURE: warmup target acquired on dirty surface managed=${String(surface.managed)} nav=${surface.nav}`);
      }
    }
    await selectRealTarget(page, target);
    session.lastSelected = target;
    session.source = target;
    const live = await resolveTarget(page, session, name);
    session.lastSelected = live;
    session.source = live;
    const kind = index % 4;
    // Alternate the drag direction every cycle so a long warmup builds a varied
    // operation history without letting geometry drift or grow without bound
    // (an unbounded pill eventually covers its siblings and nothing is clickable).
    const swing = Math.floor(index / 4) % 2 === 0 ? 1 : -1;
    if (kind === 0) await selectAndDragReal(page, live, swing * (8 + (index % 5)), swing * 4);
    else if (kind === 1) await dragHandle(page, "resize-se", swing * 10, swing * 8);
    else if (kind === 2) await dragHandle(page, "rotate", swing * 18, swing * 8);
    else await invokeLayerCommand(page, index % 8 === 3 ? "back" : "front");
    await settleVisual(page);
    session.lastSelected = await resolveTarget(page, session, name);
  }
}

async function rebindDurable(page: Page, session: RunSession): Promise<void> {
  if (session.cloneId) {
    const live = page.locator(`[data-otf-clone-id="${session.cloneId}"]`).first();
    if (await live.isVisible().catch(() => false)) {
      session.clone = live;
      session.lastSelected = live;
    }
  }
  if (session.createdId) {
    const live = page.locator(`[data-otf-element-id="${session.createdId}"]`).first();
    if (await live.isVisible().catch(() => false)) {
      session.created = live;
      session.lastSelected = live;
    }
  }
}

export async function runScenario(
  page: Page,
  context: BrowserContext,
  testInfo: TestInfo,
  scenario: Scenario,
): Promise<void> {
  const session: RunSession = {
    source: null,
    clone: null,
    cloneId: null,
    created: null,
    createdId: null,
    lastSelected: null,
    deleted: null,
    createSlot: 0,
  };
  for (const [index, step] of scenario.steps.entries()) {
    const stepNo = index + 1;
    try {
      await executeStep(page, context, session, scenario, step, stepNo);
    } catch (error) {
      const target = session.lastSelected;
      const before = target ? await captureStepSnapshot(page, target).catch(() => null) : null;
      if (target) await attachFailureArtifacts(page, testInfo, scenario.id, stepNo, before, { error: String(error) });
      throw error;
    }
  }
}

async function executeStep(
  page: Page,
  context: BrowserContext,
  session: RunSession,
  scenario: Scenario,
  step: Step,
  stepNo: number,
): Promise<void> {
  if (step.op === "warmup") {
    await warmup(page, step.count, session);
    return;
  }
  if (step.op === "wait") {
    await page.waitForTimeout(step.ms);
    if (session.deleted) {
      const hidden = await session.deleted.isHidden();
      if (!hidden) throw fail(scenario.id, stepNo, "wait", "deleted identity still visible");
    }
    return;
  }
  if (step.op === "create") {
    session.createSlot += 1;
    const x = 460 + (session.createSlot % 3) * 90;
    const y = 340 + Math.floor(session.createSlot / 3) * 70;
    await createKindFromToolbar(page, step.kind, x, y);
    session.created = page.locator("[data-otf-element-id]:not([data-otf-preview])").last();
    await expect(session.created).toBeVisible();
    session.createdId = await session.created.getAttribute("data-otf-element-id");
    session.lastSelected = session.created;
    session.source = session.created;
    return;
  }
  if (step.op === "lasso") {
    await lassoFilters(page, step.mode);
    await expectLassoSelection(page, scenario.id, stepNo);
    session.lastSelected = await linkedInFilter(page, "Mentions");
    return;
  }
  if (step.op === "lasso-again") {
    await lassoGesture(page, step.mode);
    await expectLassoSelection(page, scenario.id, stepNo);
    return;
  }
  if (step.op === "save") {
    await expectSave(page);
    return;
  }
  if (step.op === "reload") {
    await reloadLinkedInAndReplay(page, context);
    session.lastSelected = null;
    session.source = null;
    await rebindDurable(page, session);
    return;
  }
  if (step.op === "undo") {
    await page.keyboard.press("Control+z");
    await settleVisual(page);
    await rebindDurable(page, session);
    return;
  }
  if (step.op === "redo") {
    await page.keyboard.press("Control+y");
    await settleVisual(page);
    await rebindDurable(page, session);
    if (session.lastSelected) await selectRealTarget(page, session.lastSelected);
    return;
  }
  if (step.op === "group") {
    await page.keyboard.press("Control+g");
    await settleVisual(page);
    return;
  }
  if (step.op === "ungroup") {
    await page.keyboard.press("Control+Shift+g");
    await settleVisual(page);
    return;
  }

  const needsTarget = step.op === "select" || step.op === "shift-select";
  if (needsTarget) {
    const target = await resolveTarget(page, session, step.target);
    if (step.op === "shift-select") await page.keyboard.down("Shift");
    const outcome = await selectRealTarget(page, target);
    if (step.op === "shift-select") await page.keyboard.up("Shift");
    session.lastSelected = target;
    if (step.target !== "clone" && step.target !== "created") {
      session.source = target;
      await markSource(page, target);
      const stamped = await stampedTarget(page);
      if (stamped) {
        session.lastSelected = stamped;
        session.source = stamped;
      }
    }
    const box = await target.boundingBox().catch(() => null);
    const overlay = await getOverlayRect(page);
    // Only a pointer landing on the container itself implies the container should
    // be selected; a point owned through a child selects the child by design.
    if (box && overlay && box.height >= 40 && outcome.ownership === "direct") {
      if (overlay.height < box.height * 0.55 || overlay.height > box.height * 1.85) {
        throw fail(
          scenario.id,
          stepNo,
          "select",
          `overlay does not match visual target overlay=${overlay.width.toFixed(1)}x${overlay.height.toFixed(1)} target=${box.width.toFixed(1)}x${box.height.toFixed(1)}`,
        );
      }
    }
    return;
  }

  const current = session.lastSelected ?? session.created ?? session.clone ?? await stampedTarget(page) ?? await linkedInFilter(page, "Mentions");
  await current.scrollIntoViewIfNeeded().catch(() => undefined);

  if (step.op === "duplicate") {
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    session.clone = page.locator("[data-otf-clone-id]").last();
    await expect(session.clone).toBeVisible();
    const cloneId = await session.clone.getAttribute("data-otf-clone-id");
    if (!cloneId) throw fail(scenario.id, stepNo, "duplicate", "missing cloneId");
    session.cloneId = cloneId;
    session.lastSelected = session.clone;
    return;
  }
  if (step.op === "delete") {
    const doomed = session.lastSelected ?? current;
    await page.keyboard.press("Delete");
    await settleVisual(page);
    const hidden = await doomed.isHidden();
    if (!hidden) throw fail(scenario.id, stepNo, "delete", "target still visible immediately");
    session.deleted = doomed;
    return;
  }
  if (step.op === "front" || step.op === "back") {
    await invokeLayerCommand(page, step.op);
    await settleVisual(page);
    return;
  }
  if (step.op === "style") {
    await applyOpacityFromToolbar(page, "0.7");
    await settleVisual(page);
    return;
  }
  if (step.op === "move") {
    const overlayBefore = await getOverlayRect(page);
    if (overlayBefore) {
      const x = overlayBefore.x + overlayBefore.width / 2;
      const y = overlayBefore.y + overlayBefore.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + step.dx, y + step.dy, { steps: 16 });
      await page.mouse.up();
      await settleVisual(page);
      const overlayAfter = await getOverlayRect(page);
      if (!overlayAfter) throw fail(scenario.id, stepNo, "move", "overlay disappeared");
      const dx = (overlayAfter.x + overlayAfter.width / 2) - (overlayBefore.x + overlayBefore.width / 2);
      const dy = (overlayAfter.y + overlayAfter.height / 2) - (overlayBefore.y + overlayBefore.height / 2);
      if (Math.abs(step.dx) >= 80) {
        if (Math.abs(dx - step.dx) > 48 || Math.abs(dy) > 48) {
          throw fail(scenario.id, stepNo, "move", `world-axis failed dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} expectedDx=${String(step.dx)}`);
        }
      } else if (Math.hypot(dx, dy) < 6) {
        throw fail(scenario.id, stepNo, "move", `no movement dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`);
      }
      return;
    }
    const before = await captureStepSnapshot(page, current);
    await selectAndDragReal(page, current, step.dx, step.dy);
    await assertMoved(page, current, step.dx, scenario.id, stepNo, before);
    return;
  }
  if (step.op === "resize") {
    const overlayBefore = await getOverlayRect(page);
    const before = await captureStepSnapshot(page, current);
    const ok = await dragHandle(page, "resize-se", step.dx ?? 36, step.dy ?? 22);
    if (!ok) throw fail(scenario.id, stepNo, "resize", "handle missing");
    if (overlayBefore) {
      await settleVisual(page);
      const overlayAfter = await getOverlayRect(page);
      if (!overlayAfter) throw fail(scenario.id, stepNo, "resize", "overlay disappeared");
      const aabbDelta = Math.hypot(overlayAfter.width - overlayBefore.width, overlayAfter.height - overlayBefore.height);
      if (aabbDelta < 4) {
        throw fail(
          scenario.id,
          stepNo,
          "resize",
          `snapback/no-op overlay=${overlayBefore.width.toFixed(1)}x${overlayBefore.height.toFixed(1)}→${overlayAfter.width.toFixed(1)}x${overlayAfter.height.toFixed(1)}`,
        );
      }
      return;
    }
    await assertResized(page, current, scenario.id, stepNo, before);
    return;
  }
  if (step.op === "rotate") {
    const overlayBefore = await getOverlayRect(page);
    const before = overlayBefore ? null : await captureStepSnapshot(page, current);
    const ok = await dragHandle(page, "rotate", step.dx ?? 56, step.dy ?? 28);
    if (!ok) throw fail(scenario.id, stepNo, "rotate", "handle missing");
    await settleVisual(page);
    if (overlayBefore) {
      const overlayAfter = await getOverlayRect(page);
      if (!overlayAfter) throw fail(scenario.id, stepNo, "rotate", "overlay disappeared");
      const aabbDelta = Math.hypot(overlayAfter.width - overlayBefore.width, overlayAfter.height - overlayBefore.height);
      if (aabbDelta < 3) {
        throw fail(
          scenario.id,
          stepNo,
          "rotate",
          `angle did not change overlay=${overlayBefore.width.toFixed(1)}x${overlayBefore.height.toFixed(1)}→${overlayAfter.width.toFixed(1)}x${overlayAfter.height.toFixed(1)}`,
        );
      }
      return;
    }
    const after = await captureStepSnapshot(page, current);
    const rotate = Number(after.oracle.storedTransform?.rotate ?? 0);
    if (Math.abs(rotate) < 3 && Math.abs(rotate - Number(before?.oracle.storedTransform?.rotate ?? 0)) < 3) {
      throw fail(scenario.id, stepNo, "rotate", `angle did not change rotate=${String(rotate)}`);
    }
  }
}
