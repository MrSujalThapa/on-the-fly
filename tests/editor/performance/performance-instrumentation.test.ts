import { describe, expect, it } from "vitest";
import {
  createPerformanceInstrumentation,
  PERFORMANCE_DEBUG,
} from "../../../src/editor/performance/performance-instrumentation.js";

describe("performance instrumentation", () => {
  it("records selection, lasso, replay, and geometry samples", () => {
    const perf = createPerformanceInstrumentation();

    const endSelection = perf.begin("selection");
    endSelection();

    perf.record("lasso", 3.2, { selectedCount: 2 });
    perf.record("replay", 12.5, { count: 4 });
    perf.record("geometry-rebuild", 8.1, { nodeCount: 120 });
    perf.record("transform-frame", 1.1);

    expect(perf.getSamples("selection")).toHaveLength(1);
    expect(perf.getSamples("lasso")[0]?.durationMs).toBe(3.2);
    expect(perf.getSamples("replay")[0]?.detail?.count).toBe(4);
    expect(perf.getSamples("geometry-rebuild")[0]?.detail?.nodeCount).toBe(120);
    expect(perf.getSamples("transform-frame")).toHaveLength(1);
  });

  it("keeps debug logging disabled in public builds by default", () => {
    expect(PERFORMANCE_DEBUG).toBe(false);
  });
});
