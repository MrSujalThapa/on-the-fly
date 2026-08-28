import type { BrowserContext, Locator, Page } from "@playwright/test";
import { enableEditMode } from "../e2e/helpers/actions.js";
import { getOverlayRect } from "../e2e/helpers/geometry.js";
import { loadSanitizedOperations, readRuntimeDiagnostics, settleVisual } from "../e2e/helpers/runtime-state.js";
import {
  addToSelection,
  assertInvariants,
  createFromPalette,
  deleteSelection,
  duplicateSelection,
  expect,
  expectMultiSelection,
  fx,
  group,
  harnessFailure,
  lassoRegion,
  layerSelection,
  liveCloneIds,
  moveSelection,
  pillRowRegion,
  productFailure,
  redo,
  reloadAndReplay,
  resizeSelection,
  rotateSelection,
  runtimeLogTail,
  saveNonEmpty,
  selectTarget,
  styleSelection,
  undo,
  ungroup,
  applyMutation,
  type FixtureTarget,
  type MutationKind,
} from "./harness.js";
import type { Scenario, Step, TargetName } from "./manifest.js";

export interface RunSession {
  sourceName: FixtureTarget | null;
  current: Locator | null;
  cloneId: string | null;
  createdId: string | null;
  deleted: Locator | null;
  createSlot: number;
  operations: number;
  saves: number;
  reloads: number;
  lastMutation: MutationKind | null;
}

export function newSession(): RunSession {
  return {
    sourceName: null,
    current: null,
    cloneId: null,
    createdId: null,
    deleted: null,
    createSlot: 0,
    operations: 0,
    saves: 0,
    reloads: 0,
    lastMutation: null,
  };
}

function fail(caseId: string, step: number, op: string, message: string): Error {
  const trace = runtimeLogTail(8);
  const suffix = trace.length > 0 ? `\nruntime trace:\n${trace.join("\n")}` : "";
  return new Error(`${caseId} step ${String(step)} ${op}: ${message}${suffix}`);
}

function resolveTarget(page: Page, session: RunSession, name: TargetName): Locator {
  if (name === "clone") {
    if (!session.cloneId) throw new Error(harnessFailure("clone target requested before any duplicate"));
    return page.locator(`[data-otf-clone-id="${session.cloneId}"]`).first();
  }
  if (name === "created") {
    if (!session.createdId) throw new Error(harnessFailure("created target requested before any create"));
    return page.locator(`[data-otf-element-id="${session.createdId}"]`).first();
  }
  if (name === "current") {
    if (!session.current) throw new Error(harnessFailure("current target requested with no selection"));
    return session.current;
  }
  return fx(page, name);
}

/** Durable geometry of everything the editor owns, keyed by durable identity. */
async function ownedGeometry(page: Page): Promise<Record<string, { x: number; y: number; width: number; height: number }>> {
  return page.evaluate(() => {
    const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
    const nodes = document.querySelectorAll(
      "[data-otf-transform],[data-otf-managed],[data-otf-clone-id],[data-otf-element-id]",
    );
    for (const element of Array.from(nodes)) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.hasAttribute("data-otf-preview")) continue;
      const clone = element.getAttribute("data-otf-clone-id");
      const created = element.getAttribute("data-otf-element-id");
      const host = element.getAttribute("data-fx");
      const key = clone ? `clone:${clone}` : created ? `element:${created}` : host ? `host:${host}` : null;
      if (!key) continue;
      const box = element.getBoundingClientRect();
      out[key] = { x: box.x, y: box.y, width: box.width, height: box.height };
    }
    return out;
  });
}

async function assertPersistedGeometry(
  page: Page,
  before: Record<string, { x: number; y: number; width: number; height: number }>,
  caseId: string,
  stepNo: number,
  lastMutation: MutationKind | null = null,
): Promise<void> {
  const after = await ownedGeometry(page);
  for (const [key, prior] of Object.entries(before)) {
    const next = after[key];
    if (!next) {
      throw fail(caseId, stepNo, "reload", productFailure(`${key} did not survive reload`));
    }
    const sizeDrift = Math.max(
      Math.abs(next.width - prior.width),
      Math.abs(next.height - prior.height),
    );
    const posDrift = Math.max(Math.abs(next.x - prior.x), Math.abs(next.y - prior.y));
    const ignoreHostReflow = lastMutation === "reflow-siblings" && key.startsWith("host:");
    const drift = ignoreHostReflow ? sizeDrift : Math.max(sizeDrift, posDrift);
    if (drift > 20) {
      throw fail(
        caseId,
        stepNo,
        "reload",
        productFailure(`${key} drifted across reload before=${JSON.stringify(prior)} after=${JSON.stringify(next)}`),
      );
    }
  }
}

export async function runScenario(
  page: Page,
  context: BrowserContext,
  scenario: Scenario,
  session: RunSession,
): Promise<void> {
  let savedGeometry: Record<string, { x: number; y: number; width: number; height: number }> | null = null;
  for (const [index, step] of scenario.steps.entries()) {
    const stepNo = index + 1;
    const label = `${scenario.id} step ${String(stepNo)} ${step.op}`;
    savedGeometry = await executeStep(page, context, scenario, session, step, stepNo, label, savedGeometry);
    await assertInvariants(page, label);
    session.operations += 1;
  }
}

async function executeStep(
  page: Page,
  context: BrowserContext,
  scenario: Scenario,
  session: RunSession,
  step: Step,
  stepNo: number,
  label: string,
  savedGeometry: Record<string, { x: number; y: number; width: number; height: number }> | null,
): Promise<Record<string, { x: number; y: number; width: number; height: number }> | null> {
  switch (step.op) {
    case "select": {
      const target = resolveTarget(page, session, step.target);
      const outcome = await selectTarget(page, target, label);
      session.current = target;
      if (step.target !== "clone" && step.target !== "created" && step.target !== "current") {
        session.sourceName = step.target;
      }
      // A pointer that lands directly on a large host must not select a much
      // smaller descendant; a point owned through a child selects the child by
      // design and is not asserted here.
      if (outcome.ownership === "direct") {
        const box = await target.boundingBox().catch(() => null);
        if (box && box.height >= 36) {
          if (outcome.overlay.height < box.height * 0.5 || outcome.overlay.height > box.height * 2) {
            throw fail(
              scenario.id,
              stepNo,
              "select",
              productFailure(
                `overlay does not match visual target overlay=${outcome.overlay.width.toFixed(1)}x${outcome.overlay.height.toFixed(1)} target=${box.width.toFixed(1)}x${box.height.toFixed(1)}`,
              ),
            );
          }
        }
      }
      return savedGeometry;
    }
    case "shift-select": {
      const target = resolveTarget(page, session, step.target);
      await addToSelection(page, target, label);
      session.current = target;
      return savedGeometry;
    }
    case "move": {
      const selectedCount = (await readRuntimeDiagnostics(page))?.selection.length ?? 0;
      await moveSelection(page, step.dx, step.dy, label, selectedCount === 1 ? session.current : null);
      return savedGeometry;
    }
    case "resize":
      await resizeSelection(page, step.dx, step.dy, label, step.handle);
      return savedGeometry;
    case "rotate":
      await rotateSelection(page, step.dx, step.dy, label, session.current);
      return savedGeometry;
    case "front":
    case "back":
      await layerSelection(page, step.op);
      return savedGeometry;
    case "style":
      await styleSelection(page, step.value);
      return savedGeometry;
    case "duplicate": {
      const created = await duplicateSelection(page, label);
      session.cloneId = created.cloneId;
      session.current = created.locator;
      return savedGeometry;
    }
    case "copy-paste": {
      const created = await duplicateSelection(page, label);
      session.cloneId = created.cloneId;
      session.current = created.locator;
      return savedGeometry;
    }
    case "create": {
      session.createSlot += 1;
      const x = 1180 + (session.createSlot % 2) * 90;
      const y = 180 + ((session.createSlot - 1) % 4) * 130;
      const created = await createFromPalette(page, step.kind, x, y, label);
      session.createdId = created.elementId;
      session.current = created.locator;
      return savedGeometry;
    }
    case "delete": {
      await deleteSelection(page, session.current, label);
      session.deleted = session.current;
      session.current = null;
      return savedGeometry;
    }
    case "delete-source": {
      if (!session.sourceName) throw new Error(harnessFailure(`${label}: no source to delete`));
      const clonesBefore = await liveCloneIds(page);
      const source = fx(page, session.sourceName);
      await selectTarget(page, source, `${label} select-source`);
      await deleteSelection(page, source, label);
      const clonesAfter = await liveCloneIds(page);
      if (session.cloneId && !clonesAfter.includes(session.cloneId)) {
        throw fail(scenario.id, stepNo, "delete-source", productFailure("deleting the source removed the clone"));
      }
      if (clonesAfter.length !== clonesBefore.length) {
        throw fail(
          scenario.id,
          stepNo,
          "delete-source",
          productFailure(`clone count changed ${String(clonesBefore.length)} -> ${String(clonesAfter.length)}`),
        );
      }
      session.deleted = source;
      session.current = session.cloneId ? page.locator(`[data-otf-clone-id="${session.cloneId}"]`).first() : null;
      return savedGeometry;
    }
    case "undo": {
      const before = await readRuntimeDiagnostics(page);
      await undo(page);
      const after = await readRuntimeDiagnostics(page);
      if (before && after && before.cursor > 0 && after.cursor === before.cursor) {
        throw fail(scenario.id, stepNo, "undo", productFailure(`cursor did not move (${String(before.cursor)})`));
      }
      session.current = null;
      return savedGeometry;
    }
    case "redo": {
      const before = await readRuntimeDiagnostics(page);
      await redo(page);
      const after = await readRuntimeDiagnostics(page);
      if (before && after && after.cursor < before.cursor) {
        throw fail(scenario.id, stepNo, "redo", productFailure("redo moved the cursor backwards"));
      }
      return savedGeometry;
    }
    case "save": {
      const stored = await saveNonEmpty(context, page, label);
      expect(stored, `${label} persisted operations`).toBeGreaterThan(0);
      session.saves += 1;
      return ownedGeometry(page);
    }
    case "reload": {
      const expected = savedGeometry ?? (await ownedGeometry(page));
      await reloadAndReplay(page);
      await enableEditMode(context, page);
      await settleVisual(page);
      await assertPersistedGeometry(page, expected, scenario.id, stepNo, session.lastMutation);
      session.reloads += 1;
      session.current = null;
      session.deleted = null;
      return expected;
    }
    case "lasso":
    case "lasso-again": {
      const region = await pillRowRegion(page);
      await lassoRegion(page, step.mode, region, step.op === "lasso");
      await expectMultiSelection(page, label);
      session.current = fx(page, "pill-beta");
      return savedGeometry;
    }
    case "group": {
      const before = await readRuntimeDiagnostics(page);
      await group(page);
      const after = await readRuntimeDiagnostics(page);
      if ((before?.selection.length ?? 0) > 1 && (after?.groups.length ?? 0) === 0) {
        throw fail(scenario.id, stepNo, "group", productFailure("group produced no group"));
      }
      return savedGeometry;
    }
    case "ungroup": {
      await ungroup(page);
      const after = await readRuntimeDiagnostics(page);
      if ((after?.groups.length ?? 0) !== 0) {
        throw fail(scenario.id, stepNo, "ungroup", productFailure("group survived ungroup"));
      }
      return savedGeometry;
    }
    case "mutate": {
      const before = await readRuntimeDiagnostics(page);
      const storedBefore = await loadSanitizedOperations(context, page);
      const geometryBefore = await ownedGeometry(page);
      await applyMutation(page, step.kind);
      await page.waitForTimeout(50);
      session.lastMutation = step.kind;
      const after = await readRuntimeDiagnostics(page);
      const storedAfter = await loadSanitizedOperations(context, page);
      if (before && after && after.activeCount > before.activeCount) {
        throw fail(
          scenario.id,
          stepNo,
          "mutate",
          productFailure(
            `host mutation resurrected operations active=${String(before.activeCount)} -> ${String(after.activeCount)}`,
          ),
        );
      }
      if (storedAfter.length !== storedBefore.length) {
        throw fail(
          scenario.id,
          stepNo,
          "mutate",
          productFailure(`host mutation changed persisted operations ${String(storedBefore.length)} -> ${String(storedAfter.length)}`),
        );
      }
      // An unrelated sibling mutation must not teleport edits that were never
      // touched. Nodes the mutation itself replaced are excluded because the
      // fixture deliberately discards their editor state.
      if (step.kind !== "reflow-siblings") {
        const geometryAfter = await ownedGeometry(page);
        for (const [key, prior] of Object.entries(geometryBefore)) {
          const next = geometryAfter[key];
          if (!next) continue;
          const drift = Math.hypot(next.x - prior.x, next.y - prior.y);
          if (drift > 90) {
            throw fail(
              scenario.id,
              stepNo,
              "mutate",
              productFailure(`${key} teleported after host mutation drift=${drift.toFixed(1)}`),
            );
          }
        }
      }
      return savedGeometry;
    }
    case "wait":
      await page.waitForTimeout(step.ms);
      if (session.deleted) {
        const visible = await session.deleted.isVisible().catch(() => false);
        if (visible) throw fail(scenario.id, stepNo, "wait", productFailure("deleted identity reappeared"));
      }
      return savedGeometry;
    default: {
      const exhaustive: never = step;
      throw new Error(`unhandled step ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Restores a usable selection when a step consumed it (undo, reload, delete). */
export async function ensureSelection(page: Page, session: RunSession, label: string): Promise<void> {
  if (await getOverlayRect(page)) return;
  const fallback = session.current ?? fx(page, "pill-beta");
  await selectTarget(page, fallback, label);
  session.current = fallback;
}
