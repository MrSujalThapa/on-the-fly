import { describe, expect, it } from "vitest";
import {
  getEditModeForTab,
  handleTabUpdatedForEditModeReset,
  setEditModeForTab,
} from "../../src/background/edit-mode-state.js";

describe("edit mode on refresh", () => {
  it("clears background tab state when navigation starts loading", () => {
    setEditModeForTab(99, true);
    expect(getEditModeForTab(99)).toBe(true);

    handleTabUpdatedForEditModeReset(99, { status: "loading" });

    expect(getEditModeForTab(99)).toBe(false);
  });
});
