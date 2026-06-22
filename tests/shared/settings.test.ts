import { describe, expect, it } from "vitest";
import { normalizeExtensionSettings } from "../../src/shared/settings.js";
import { shouldRestoreEditModeForTab } from "../../src/background/settings-storage.js";

describe("extension settings", () => {
  it("forces restoreEditModeOnLoad to false even when stored value is true", () => {
    const settings = normalizeExtensionSettings({
      restoreEditModeOnLoad: true,
      toolbarPlacement: "top",
    });

    expect(settings.restoreEditModeOnLoad).toBe(false);
  });

  it("never restores edit mode on tab load", () => {
    expect(shouldRestoreEditModeForTab()).toBe(false);
  });
});
