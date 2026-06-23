import { describe, expect, it } from "vitest";
import {
  finalizeLatencyStages,
  identifyLatencyBottleneck,
} from "../../src/shared/agent-latency.js";

describe("agent latency diagnostics", () => {
  it("identifies OpenAI as the bottleneck when it dominates server time", () => {
    const bottleneck = identifyLatencyBottleneck({
      contextBuildMs: 2,
      serverRequestMs: 14_200,
      openAiCallMs: 14_000,
      compileMs: 3,
      validationMs: 2,
      previewApplyMs: 5,
    });

    expect(bottleneck).toBe("openai");
  });

  it("identifies extension preview when apply dominates", () => {
    const bottleneck = identifyLatencyBottleneck({
      contextBuildMs: 1,
      serverRequestMs: 50,
      openAiCallMs: 40,
      compileMs: 2,
      validationMs: 1,
      previewApplyMs: 400,
    });

    expect(bottleneck).toBe("extension_preview");
  });

  it("finalizes totalMs and bottleneck from stage timings", () => {
    const finalized = finalizeLatencyStages(
      {
        contextBuildMs: 3,
        serverRequestMs: 12_500,
        openAiCallMs: 12_000,
        compileMs: 4,
        validationMs: 2,
        previewApplyMs: 8,
      },
      12_520,
    );

    expect(finalized.totalMs).toBe(12_520);
    expect(finalized.bottleneck).toBe("openai");
  });
});
