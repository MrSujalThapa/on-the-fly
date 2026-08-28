import {
  assertInvariants,
  diagnostics,
  expect,
  fx,
  moveSelection,
  resizeSelection,
  selectTarget,
  startCase,
  test,
} from "./harness.js";

test.describe("local chromium smoke", () => {
  test("edit mode reaches the fixture and a pill can be selected, moved and resized", async ({ context, page }) => {
    await startCase(context, page, "smoke");
    const target = fx(page, "pill-beta");
    const outcome = await selectTarget(page, target, "smoke select");
    expect(outcome.overlay.width).toBeGreaterThan(10);
    await assertInvariants(page, "smoke select");
    await moveSelection(page, 40, 24, "smoke move");
    await assertInvariants(page, "smoke move");
    await resizeSelection(page, 30, 18, "smoke resize");
    await assertInvariants(page, "smoke resize");
    const diag = await diagnostics(page);
    expect(diag.activeCount).toBeGreaterThan(0);
  });
});
