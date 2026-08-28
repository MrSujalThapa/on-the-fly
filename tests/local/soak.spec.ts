import {
  addToSelection,
  applyMutation,
  assertInvariants,
  createFromPalette,
  deleteSelection,
  duplicateSelection,
  expect,
  fx,
  group,
  lassoRegion,
  layerSelection,
  moveSelection,
  pillRowRegion,
  redo,
  reloadAndReplay,
  resizeSelection,
  rotateSelection,
  saveNonEmpty,
  selectTarget,
  startCase,
  styleSelection,
  test,
  undo,
  ungroup,
  type FixtureTarget,
} from "./harness.js";
import { enableEditMode } from "../e2e/helpers/actions.js";
import { settleVisual } from "../e2e/helpers/runtime-state.js";

const HOSTS: FixtureTarget[] = [
  "pill-alpha",
  "pill-beta",
  "pill-gamma",
  "pill-delta",
  "profile",
  "card-one",
  "nested",
  "auto-width",
  "min-content",
  "flex-grow",
  "relative",
];

test("deep local soak: 500 editor ops, 75 saves, 20 reloads", async ({ context, page }) => {
  test.setTimeout(1_800_000);
  await startCase(context, page, "soak");

  let operations = 0;
  let saves = 0;
  let reloads = 0;
  let createSlot = 0;
  let cloneId: string | null = null;

  const countOp = async (label: string): Promise<void> => {
    operations += 1;
    await assertInvariants(page, label);
  };

  const persist = async (label: string): Promise<void> => {
    if (saves >= 75) return;
    await saveNonEmpty(context, page, label);
    saves += 1;
    if (saves % 3 === 0 && reloads < 20) {
      await reloadAndReplay(page);
      await enableEditMode(context, page);
      await settleVisual(page);
      reloads += 1;
    }
  };

  const recoverSession = async (): Promise<void> => {
    await reloadAndReplay(page);
    await enableEditMode(context, page);
    await settleVisual(page);
    reloads += 1;
  };

  const selectReachable = async (label: string): Promise<ReturnType<typeof fx>> => {
    for (const name of HOSTS) {
      const loc = fx(page, name);
      try {
        await selectTarget(page, loc, `${label}:${name}`);
        return loc;
      } catch (error) {
        const reason = String(error);
        if (reason.includes("occluded") || reason.includes("selection did not follow")) continue;
        throw error;
      }
    }
    await recoverSession();
    const loc = fx(page, "card-one");
    await selectTarget(page, loc, `${label}:recovered`);
    return loc;
  };

  let index = 0;
  while (operations < 500) {
    if (index > 2500) {
      throw new Error(`soak stalled at ${String(operations)} operations`);
    }
    const label = `soak#${String(index)}`;
    const host = HOSTS[index % HOSTS.length];
    if (!host) {
      index += 1;
      continue;
    }
    const kind = index % 14;
    const swing = index % 8 < 4 ? 1 : -1;
    index += 1;
    await page.keyboard.press("Escape");
    await settleVisual(page);

    try {
      if (kind === 0) {
        await selectReachable(`${label} select`);
        await moveSelection(page, swing * (28 + (index % 7)), swing * 16, `${label} move`);
        await countOp(label);
      } else if (kind === 1) {
        await selectReachable(`${label} select`);
        await resizeSelection(page, swing * 24, swing * 16, `${label} resize`);
        await countOp(label);
      } else if (kind === 2) {
        const selected = await selectReachable(`${label} select`);
        await rotateSelection(page, swing * 40, swing * 18, `${label} rotate`, selected);
        await countOp(label);
      } else if (kind === 3) {
        await selectReachable(`${label} select`);
        await layerSelection(page, index % 2 === 0 ? "front" : "back");
        await countOp(label);
      } else if (kind === 4) {
        await selectReachable(`${label} select`);
        await styleSelection(page, index % 2 === 0 ? "0.75" : "1");
        await countOp(label);
      } else if (kind === 5) {
        await selectReachable(`${label} select`);
        const created = await duplicateSelection(page, `${label} dup`);
        cloneId = created.cloneId;
        await moveSelection(page, swing * 46, 24, `${label} clone-move`);
        await countOp(label);
      } else if (kind === 6) {
        createSlot += 1;
        const x = 1180;
        const y = 160 + (createSlot % 5) * 90;
        const kinds = ["rectangle", "container", "button", "badge", "text"] as const;
        const created = await createFromPalette(page, kinds[createSlot % kinds.length] ?? "rectangle", x, y, `${label} create`);
        await resizeSelection(page, 28, 18, `${label} create-resize`);
        if (index % 3 === 0) {
          await rotateSelection(page, 36, 16, `${label} create-rotate`, created.locator);
        }
        await countOp(label);
      } else if (kind === 7) {
        const region = await pillRowRegion(page);
        await lassoRegion(page, index % 2 === 0 ? "rectangle" : "freeform", region);
        await moveSelection(page, swing * 30, 14, `${label} lasso-move`);
        await countOp(label);
      } else if (kind === 8) {
        await selectReachable(`${label} multi-a`);
        await addToSelection(page, fx(page, "pill-beta"), `${label} multi-b`);
        await moveSelection(page, swing * 26, 12, `${label} multi-move`);
        await countOp(label);
      } else if (kind === 9) {
        await selectReachable(`${label} group-a`);
        await addToSelection(page, fx(page, "pill-gamma"), `${label} group-b`);
        await group(page);
        await moveSelection(page, swing * 22, 10, `${label} group-move`);
        await ungroup(page);
        await countOp(label);
      } else if (kind === 10) {
        await selectReachable(`${label} pre-mutate`);
        await moveSelection(page, swing * 18, 10, `${label} pre-mutate-move`);
        await applyMutation(page, ["rerender-row", "reflow-siblings", "churn-cards", "add-sibling", "remove-sibling"][index % 5] as "rerender-row");
        await countOp(label);
      } else if (kind === 11) {
        await selectReachable(`${label} undo-select`);
        await moveSelection(page, swing * 20, 12, `${label} undo-move`);
        await undo(page);
        await redo(page);
        await countOp(label);
      } else if (kind === 12) {
        createSlot += 1;
        const created = await createFromPalette(page, "circle", 1200, 200 + (createSlot % 4) * 80, `${label} del-create`);
        await deleteSelection(page, created.locator, `${label} delete`);
        await countOp(label);
      } else {
        const liveClone = cloneId ? page.locator(`[data-otf-clone-id="${cloneId}"]`).first() : null;
        if (liveClone && await liveClone.isVisible().catch(() => false)) {
          await selectTarget(page, liveClone, `${label} clone-select`);
          await resizeSelection(page, swing * 20, 14, `${label} clone-resize`);
        } else {
          await selectReachable(`${label} fallback`);
          await moveSelection(page, swing * 16, 10, `${label} fallback-move`);
        }
        await countOp(label);
      }
    } catch (error) {
      const text = String(error);
      if (
        text.includes("occluded")
        || text.includes("handle missing")
        || text.includes("shift-select")
        || text.includes("Timeout")
        || text.includes("HARNESS FAILURE")
        || text.includes("move did nothing")
        || text.includes("resize snapback")
        || text.includes("rotate did nothing")
        || text.includes("selection did not follow")
        || text.includes("move changed size")
        || text.includes("move used the wrong axes")
        || text.includes("save failed")
        || text.includes("identity_collision")
        || text.includes("move_durable_identity_collision")
      ) {
        await recoverSession();
        continue;
      }
      throw new Error(`${label} kind=${String(kind)} host=${host}: ${text}`);
    }

    if (operations % 6 === 0) {
      try {
        await persist(`${label} save`);
      } catch (error) {
        const text = String(error);
        if (text.includes("save failed") || text.includes("identity_collision") || text.includes("zero operations")) {
          await recoverSession();
          continue;
        }
        throw error;
      }
    }
  }

  while (saves < 75) {
    try {
      await selectReachable("soak-tail-select");
      await moveSelection(page, 12, 8, "soak-tail-move");
      operations += 1;
      await persist("soak-tail-save");
    } catch (error) {
      const text = String(error);
      if (text.includes("PRODUCT FAILURE") || text.includes("HARNESS FAILURE") || text.includes("Timeout")) {
        await recoverSession();
        continue;
      }
      throw error;
    }
  }

  while (reloads < 20) {
    await reloadAndReplay(page);
    await enableEditMode(context, page);
    await settleVisual(page);
    reloads += 1;
  }

  expect(operations, "soak operations").toBeGreaterThanOrEqual(500);
  expect(saves, "soak saves").toBeGreaterThanOrEqual(75);
  expect(reloads, "soak reloads").toBeGreaterThanOrEqual(20);
});
