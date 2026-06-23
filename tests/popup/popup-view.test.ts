import { describe, expect, it } from "vitest";
import {
  formatPopupDiagnostics,
  formatSavedOpsDisplayCount,
} from "../../src/popup/popup-view.js";

describe("popup view copy", () => {
  it("shows saved ops and agent status without restore-on-load wording", () => {
    const copy = formatPopupDiagnostics({
      operationCount: 3,
      agentEnabled: false,
    });

    expect(copy).toBe("Saved ops: 3 | Agent disabled");
    expect(copy).not.toContain("Restore on load");
  });

  it("formats saved ops count for the card footer", () => {
    expect(formatSavedOpsDisplayCount(3)).toBe("3");
    expect(formatSavedOpsDisplayCount(null)).toBe("-");
  });
});
