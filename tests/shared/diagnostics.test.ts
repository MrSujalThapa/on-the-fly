import { afterEach, describe, expect, it, vi } from "vitest";
import {
  areDiagnosticsEnabled,
  emitDiagnostic,
  setDiagnosticsEnabled,
} from "../../src/shared/diagnostics.js";
import { buildFlags } from "../../src/shared/build-flags.js";
import { logSelectionDebug } from "../../src/editor/selection/selection-debug.js";

describe("development diagnostic gate", () => {
  afterEach(() => {
    setDiagnosticsEnabled(false);
    vi.restoreAllMocks();
  });

  it("is off in a build that did not opt in", () => {
    expect(buildFlags.diagnosticsEnabled).toBe(false);
    expect(areDiagnosticsEnabled()).toBe(false);
  });

  it("stays silent while disabled", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);

    emitDiagnostic("page-replay", { count: 3 });
    logSelectionDebug("click-resolve", { count: 1 });

    expect(debug).not.toHaveBeenCalled();
  });

  it("routes events to the console sink once enabled", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    setDiagnosticsEnabled(true);

    emitDiagnostic("page-replay", { count: 3 });
    logSelectionDebug("click-resolve");

    expect(debug).toHaveBeenNthCalledWith(1, "[OTF] page-replay", { count: 3 });
    expect(debug).toHaveBeenNthCalledWith(2, "[OTF] click-resolve");
  });

  it("never lets a failing sink reach the caller", () => {
    vi.spyOn(console, "debug").mockImplementation(() => {
      throw new Error("sink exploded");
    });
    setDiagnosticsEnabled(true);

    expect(() => {
      emitDiagnostic("transform-apply-failed", { code: "target_not_found" });
    }).not.toThrow();
  });
});
