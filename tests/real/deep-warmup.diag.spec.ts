import { getOverlayRect } from "../e2e/helpers/geometry.js";
import { invokeLayerCommand } from "./chrome-ui.js";
import { dragHandle } from "./oracles.js";
import {
  enableEdit,
  readRuntimeDiagnostics,
  resetPersistedPage,
  selectAndDragReal,
  selectRealTarget,
  settleVisual,
  test,
} from "./harness.js";
import { linkedInFilter, linkedInFilters, requireLinkedInAuth } from "./linkedin.js";

type FilterName = "All" | "Jobs" | "My posts" | "Mentions";

const ORDER: readonly FilterName[] = ["Mentions", "Jobs", "My posts", "All"];

async function filterState(page: import("@playwright/test").Page): Promise<unknown> {
  return page.evaluate(() => {
    const names = ["All", "Jobs", "My posts", "Mentions"];
    const rows: unknown[] = [];
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("a,button,[role='radio'],[role='tab']"))) {
      const text = (node.textContent ?? "").replace(/\s+/gu, " ").trim();
      const matched = names.find((name) => text.startsWith(name));
      if (!matched) continue;
      const box = node.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) continue;
      rows.push({
        name: matched,
        rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
        managed: node.getAttribute("data-otf-managed"),
        detached: node.getAttribute("data-otf-detached"),
        transform: node.getAttribute("data-otf-transform"),
        parent: node.parentElement?.tagName ?? null,
      });
    }
    return rows;
  });
}

test.describe.serial("DEEP warmup divergence", () => {
  test("walk 20 warmup operations and record first divergence", async ({ page, context }) => {
    test.setTimeout(900_000);
    await requireLinkedInAuth(page);
    await resetPersistedPage(context, page);
    await linkedInFilters(page);
    await enableEdit(context, page);
    await settleVisual(page);

    const consoleLog: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (text.includes("[otf-v2]")) consoleLog.push(text.slice(0, 600));
    });

    const log: unknown[] = [];
    let firstDivergence: string | null = null;

    for (let index = 0; index < 20; index += 1) {
      const name = ORDER[index % ORDER.length] as FilterName;
      const kind = index % 4;
      const opName = kind === 0 ? "move" : kind === 1 ? "resize" : kind === 2 ? "rotate" : "layer";
      const target = await linkedInFilter(page, name);
      const beforeBox = await target.boundingBox();
      let selectError: string | null = null;
      try {
        await selectRealTarget(page, target);
      } catch (error) {
        selectError = String(error).slice(0, 400);
      }
      const overlay = await getOverlayRect(page);
      const diagAfterSelect = await readRuntimeDiagnostics(page);
      const overlayMatchesTarget = Boolean(
        overlay && beforeBox &&
        Math.abs(overlay.x - beforeBox.x) < 24 && Math.abs(overlay.y - beforeBox.y) < 24 &&
        Math.abs(overlay.width - beforeBox.width) < 24 && Math.abs(overlay.height - beforeBox.height) < 24,
      );
      if (!selectError && !overlayMatchesTarget && firstDivergence === null) {
        firstDivergence = `step ${String(index)} select ${name}: overlay=${JSON.stringify(overlay)} target=${JSON.stringify(beforeBox)}`;
      }
      if (selectError && firstDivergence === null) {
        firstDivergence = `step ${String(index)} select ${name}: ${selectError}`;
      }

      let opError: string | null = null;
      if (!selectError) {
        try {
          const live = await linkedInFilter(page, name);
          if (kind === 0) await selectAndDragReal(page, live, 8 + (index % 5), 4);
          else if (kind === 1) await dragHandle(page, "resize-se", 10, 8);
          else if (kind === 2) await dragHandle(page, "rotate", 18, 8);
          else await invokeLayerCommand(page, index % 8 === 3 ? "back" : "front");
          await settleVisual(page);
        } catch (error) {
          opError = String(error).slice(0, 400);
        }
      }

      const diag = await readRuntimeDiagnostics(page);
      const runtimeEvents = consoleLog.splice(0, consoleLog.length);
      log.push({
        index,
        name,
        op: opName,
        runtimeEvents,
        targetBefore: beforeBox ? [Math.round(beforeBox.x), Math.round(beforeBox.y), Math.round(beforeBox.width), Math.round(beforeBox.height)] : null,
        overlayAfterSelect: overlay ? [Math.round(overlay.x), Math.round(overlay.y), Math.round(overlay.width), Math.round(overlay.height)] : null,
        overlayMatchesTarget,
        selectError,
        opError,
        selectionAfterSelect: diagAfterSelect?.selection ?? null,
        selectionDetailAfterSelect: diagAfterSelect?.selectionDetail ?? null,
        lastPick: diagAfterSelect?.lastPick ?? null,
        activeCount: diag?.activeCount ?? null,
        activeTypes: diag?.active.map((row) => `${row.type}:${String(row.nodeId)}`) ?? null,
        reapply: diag?.reapply.slice(-3) ?? null,
        filters: await filterState(page),
      });
      if (selectError || opError) break;
    }

    const { writeFileSync } = await import("node:fs");
    writeFileSync("test-results/deep-warmup.json", JSON.stringify({ firstDivergence, log }, null, 1), "utf8");
    throw new Error(`DIAGNOSTIC COMPLETE firstDivergence=${String(firstDivergence)}`);
  });
});
