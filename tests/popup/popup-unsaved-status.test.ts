import { describe, expect, it } from "vitest";
import { formatUnsavedStatus } from "../../src/popup/popup-view.js";

describe("popup unsaved status", () => {
  it("shows unsaved count only when edit mode is active", () => {
    expect(formatUnsavedStatus(3, true)).toBe("3 unsaved");
    expect(formatUnsavedStatus(3, false)).toBe("");
    expect(formatUnsavedStatus(0, true)).toBe("");
    expect(formatUnsavedStatus(null, true)).toBe("");
  });
});
