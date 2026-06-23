import { describe, expect, it, vi } from "vitest";
import { runAgentGenerationPipeline } from "../../agent-server/src/generation-pipeline.js";
import { OpenAiGenerationError } from "../../agent-server/src/providers/openai.js";
import type { ModelProviderAdapter } from "../../agent-server/src/providers/types.js";
import type { AgentEditRequest, AgentEditResponse } from "../../src/shared/agent-contracts.js";

const BASE_REQUEST: AgentEditRequest = {
  pageKey: "https://example.com/",
  instruction: "Make this card feel more premium.",
  selection: { selectedNodeIds: ["node-1"], source: "click" },
  selectedNodes: [
    {
      id: "node-1",
      kind: "container",
      signature: {
        cssPath: "main article.card",
        tagName: "article",
        classList: ["card"],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 10, y: 20, width: 120, height: 80 },
      computed: {},
      childIds: [],
    },
  ],
  nearbyNodes: [],
  existingOperations: [],
};

describe("generation pipeline", () => {
  it("retries once with repair errors after invalid model output", async () => {
    const generateStructuredOperations = vi
      .fn<ModelProviderAdapter["generateStructuredOperations"]>()
      .mockRejectedValueOnce(new OpenAiGenerationError("bad design plan", "invalid_model_output"))
      .mockResolvedValueOnce({
        draftOperations: [],
        summary: ["Added panel"],
        warnings: [],
        confidence: "high",
      } satisfies AgentEditResponse);

    const result = await runAgentGenerationPipeline(
      {
        id: "test",
        provider: "test",
        modelName: "test",
        generateStructuredOperations,
      },
      BASE_REQUEST,
      { timeoutMs: 5_000, requestId: "req-1" },
    );

    expect(generateStructuredOperations).toHaveBeenCalledTimes(2);
    expect(generateStructuredOperations.mock.calls[1]?.[1]?.repairErrors).toEqual(["bad design plan"]);
    expect(result.repairAttempted).toBe(true);
    expect(result.latencyStages).toBeDefined();
  });

  it("returns 422-worthy failure when repair also fails", async () => {
    const generateStructuredOperations = vi
      .fn<ModelProviderAdapter["generateStructuredOperations"]>()
      .mockRejectedValueOnce(new OpenAiGenerationError("bad payload", "invalid_model_output"))
      .mockRejectedValueOnce(new OpenAiGenerationError("still bad", "unsafe_model_output"));

    await expect(
      runAgentGenerationPipeline(
        {
          id: "test",
          provider: "test",
          modelName: "test",
          generateStructuredOperations,
        },
        BASE_REQUEST,
        { timeoutMs: 5_000, requestId: "req-2" },
      ),
    ).rejects.toBeInstanceOf(OpenAiGenerationError);

    expect(generateStructuredOperations).toHaveBeenCalledTimes(2);
  });
});
