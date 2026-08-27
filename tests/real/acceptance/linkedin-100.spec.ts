import { familyCounts, SCENARIOS, type Family } from "./manifest.js";
import { runScenario } from "./driver.js";
import {
  assertCleanEditorState,
  attachRealFailureArtifacts,
  enableEdit,
  resetPersistedPage,
  settleVisual,
  test,
} from "../harness.js";
import { linkedInFilters, requireLinkedInAuth } from "../linkedin.js";

const counts = familyCounts(SCENARIOS);
if (SCENARIOS.length < 100) throw new Error(`manifest has ${String(SCENARIOS.length)} scenarios, need 100`);
if (counts.host < 15 || counts.clone < 20 || counts.created < 15 || counts.layer < 10 || counts.delete < 10 || counts.lasso < 10 || counts.persist < 10 || counts.deep < 10) {
  throw new Error(`family distribution short: ${JSON.stringify(counts)}`);
}

const SLOW_FAMILIES = new Set<Family>(["persist", "delete", "deep"]);

// Not serial: every case asserts a clean editor surface first, so one failure
// must not skip the remaining cases.
test.describe("LinkedIn 100-case state-transition acceptance", () => {
  test.beforeEach(async ({ page, context }) => {
    await requireLinkedInAuth(page);
    await resetPersistedPage(context, page);
    await linkedInFilters(page);
    await enableEdit(context, page);
    await settleVisual(page);
  });

  test.afterEach(async ({ page, context }, testInfo) => {
    await attachRealFailureArtifacts(page, context, testInfo);
  });

  for (const scenario of SCENARIOS) {
    test(`${scenario.id} ${scenario.title}`, async ({ page, context }, testInfo) => {
      test.setTimeout(SLOW_FAMILIES.has(scenario.family) ? 420_000 : 180_000);
      await assertCleanEditorState(context, page, scenario.id);
      await runScenario(page, context, testInfo, scenario);
    });
  }
});

export const FAMILY_BUDGET: Record<Family, number> = counts;
