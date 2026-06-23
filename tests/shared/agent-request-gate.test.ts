import { describe, expect, it, vi } from "vitest";
import { canExtensionCallLocalAgent } from "../../src/shared/agent-request-gate.js";
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

describe("agent request gate", () => {
  it("blocks public builds from calling the local agent", async () => {
    expect(
      canExtensionCallLocalAgent({
        publicAgentEnabled: false,
        localDevAgentEnabled: false,
      }),
    ).toBe(false);

    const result = await proxyAgentEditRequest(SAMPLE_REQUEST, {
      flags: {
        publicAgentEnabled: false,
        localDevAgentEnabled: false,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("agent_disabled_in_public_build");
    }
  });

  it("allows local dev builds to call localhost only", async () => {
    expect(
      canExtensionCallLocalAgent({
        publicAgentEnabled: false,
        localDevAgentEnabled: true,
      }),
    ).toBe(true);

    const fetchImpl = vi.fn(
      (): Promise<Response> =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ok: true,
              response: {
                draftOperations: [],
                summary: ["mock"],
                warnings: [],
                confidence: "high",
              },
            }),
        } as Response),
    );

    const result = await proxyAgentEditRequest(SAMPLE_REQUEST, {
      flags: {
        publicAgentEnabled: false,
        localDevAgentEnabled: true,
      },
      configuredServerUrl: "http://127.0.0.1:4317",
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/agent/edit",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects non-localhost configured URLs", async () => {
    const result = await proxyAgentEditRequest(SAMPLE_REQUEST, {
      flags: {
        publicAgentEnabled: false,
        localDevAgentEnabled: true,
      },
      configuredServerUrl: "http://evil.example.com:4317",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("agent_url_not_allowed");
    }
  });
});
