import { describe, expect, it, vi } from "vitest";
import { proxyAgentEditRequest } from "../../src/background/agent-proxy.js";
import type { AgentEditRequest } from "../../src/shared/agent-contracts.js";

const SAMPLE_REQUEST: AgentEditRequest = {
  pageKey: "https://example.com/",
  instruction: "Add a soft background panel.",
  selection: { selectedNodeIds: ["node-1"], source: "click" },
  selectedNodes: [],
  nearbyNodes: [],
  existingOperations: [],
};

describe("agent proxy structured responses", () => {
  it("maps manual tool recommendations from successful HTTP responses", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            status: "manual_tool_recommended",
            guidance: {
              summary: ["Use the style toolbar to change text color."],
              warnings: [],
              matchedIntent: "text_color",
            },
            requestId: "req-manual-1",
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await proxyAgentEditRequest(SAMPLE_REQUEST, {
      flags: { publicAgentEnabled: false, localDevAgentEnabled: true },
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("manual_tool_recommended");
      expect(result.summary?.[0]).toContain("style toolbar");
      expect(result.requestId).toBe("req-manual-1");
    }
  });

  it("maps timeout and validation failures", async () => {
    const timeoutFetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            code: "timeout",
            error: "openai_generation_timeout_45000ms",
            requestId: "req-timeout-1",
          }),
          { status: 504 },
        ),
      ),
    );

    const timeoutResult = await proxyAgentEditRequest(SAMPLE_REQUEST, {
      flags: { publicAgentEnabled: false, localDevAgentEnabled: true },
      fetchImpl: timeoutFetch,
    });
    expect(timeoutResult.ok).toBe(false);
    if (!timeoutResult.ok) {
      expect(timeoutResult.code).toBe("timeout");
    }

    const validationFetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            code: "validation_failed",
            error: "invalid_model_output",
            details: ["operations[0].type duplicate is not allowed"],
            requestId: "req-val-1",
          }),
          { status: 422 },
        ),
      ),
    );

    const validationResult = await proxyAgentEditRequest(SAMPLE_REQUEST, {
      flags: { publicAgentEnabled: false, localDevAgentEnabled: true },
      fetchImpl: validationFetch,
    });
    expect(validationResult.ok).toBe(false);
    if (!validationResult.ok) {
      expect(validationResult.code).toBe("validation_failed");
      expect(validationResult.details?.[0]).toContain("duplicate");
    }
  });
});
