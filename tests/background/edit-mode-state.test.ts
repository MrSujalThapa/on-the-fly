import { describe, expect, it } from "vitest";
import {
  getEditModeForTab,
  handleTabUpdatedForEditModeReset,
  setEditModeForTab,
} from "../../src/background/edit-mode-state.js";

describe("edit mode tab state", () => {
  it("clears edit mode when a tab refreshes or navigates", () => {
    setEditModeForTab(42, true);
    expect(getEditModeForTab(42)).toBe(true);

    handleTabUpdatedForEditModeReset(42, { status: "loading" });

    expect(getEditModeForTab(42)).toBe(false);
  });

  it("leaves current-session edit mode alone for non-loading updates", () => {
    setEditModeForTab(43, true);

    handleTabUpdatedForEditModeReset(43, { status: "complete" });

    expect(getEditModeForTab(43)).toBe(true);
  });
});
