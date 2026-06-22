import { describe, expect, it } from "vitest";
import {
  mergeExtensionSettings,
  normalizeExtensionSettings,
  normalizeSettingsSnapshot,
  parseSettingsResponse,
  DEFAULT_EXTENSION_SETTINGS,
} from "../../src/shared/settings.js";
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

  it("migrates stored last edit mode and restore flags off", () => {
    const snapshot = normalizeSettingsSnapshot({
      settings: { restoreEditModeOnLoad: true },
      lastEditModeEnabled: true,
      updatedAt: 10,
    });

    expect(snapshot.settings.restoreEditModeOnLoad).toBe(false);
    expect(snapshot.lastEditModeEnabled).toBe(false);
  });

  it("ignores attempts to enable restore-on-load", () => {
    const next = mergeExtensionSettings(DEFAULT_EXTENSION_SETTINGS, {
      restoreEditModeOnLoad: true,
    });

    expect(next.restoreEditModeOnLoad).toBe(false);
  });

  it("reports popup edit-mode restore state as disabled", () => {
    const response = parseSettingsResponse({
      ok: true,
      settings: { restoreEditModeOnLoad: true },
      lastEditModeEnabled: true,
    });

    expect(response.settings?.restoreEditModeOnLoad).toBe(false);
    expect(response.lastEditModeEnabled).toBe(false);
  });
});
