import { newSession, runScenario } from "./driver.js";
import { expect, startCase, test } from "./harness.js";
import { SCENARIOS, stepSignature } from "./manifest.js";

test.describe("local chromium state-transition matrix", () => {
  test("the manifest is a set of distinct operation sequences", () => {
    const ids = new Set(SCENARIOS.map((scenario) => scenario.id));
    expect(ids.size, "scenario ids must be unique").toBe(SCENARIOS.length);
    const signatures = new Set(SCENARIOS.map((scenario) => `${scenario.family}:${stepSignature(scenario)}`));
    expect(signatures.size, "operation sequences must be distinct").toBe(SCENARIOS.length);
    expect(SCENARIOS.length, "at least 150 distinct sequences").toBeGreaterThanOrEqual(150);
  });

  for (const scenario of SCENARIOS) {
    test(scenario.id, async ({ context, page }) => {
      await startCase(context, page, scenario.id);
      await runScenario(page, context, scenario, newSession());
    });
  }
});
