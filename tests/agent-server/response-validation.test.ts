import { describe, expect, it } from "vitest";
import { parseModelAgentEditResponse } from "../../agent-server/src/response-validation.js";
import type { AgentEditRequest } from "../../src/shared/agent-contracts.js";
import { createInsertHelperObjectOperation } from "../editor/fixtures.js";

const BASE_REQUEST: AgentEditRequest = {
  pageKey: "https://example.com/",
  instruction: "Add a soft background panel.",
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
      rect: { x: 40, y: 60, width: 180, height: 120 },
      computed: {},
      childIds: [],
    },
  ],
  nearbyNodes: [],
  existingOperations: [],
};

describe("parseModelAgentEditResponse", () => {
  it("rejects malformed JSON strings", () => {
    const result = parseModelAgentEditResponse("{not-json", BASE_REQUEST);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("malformed_json");
    }
  });

  it("rejects raw draftOperations from the model", () => {
    const operation = createInsertHelperObjectOperation({
      source: "agent",
      status: "preview",
    });

    const result = parseModelAgentEditResponse(
      {
        draftOperations: [operation],
        summary: ["Should fail"],
        warnings: [],
        confidence: "low",
      },
      BASE_REQUEST,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("draftOperations are not accepted");
      expect(result.code).toBe("invalid_model_output");
    }
  });

  it("rejects duplicate operation payloads even if nested", () => {
    const result = parseModelAgentEditResponse(
      {
        designPlan: {
          actions: [{ kind: "add_surface" }],
        },
        summary: ["<script>alert(1)</script>"],
        warnings: [],
        confidence: "low",
      },
      BASE_REQUEST,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsafe_model_output");
    }
  });

  it("accepts a valid design plan and compiles to helper-object operations", () => {
    const result = parseModelAgentEditResponse(
      {
        designPlan: {
          actions: [
            {
              kind: "add_surface",
              params: {
                placement: "behind",
                fill: "gradient",
                mood: "cool",
                shadow: "soft",
                radius: "rounded",
              },
            },
          ],
        },
        summary: ["Added one background panel behind the selection."],
        warnings: [],
        confidence: "high",
      },
      BASE_REQUEST,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.draftOperations.length).toBeGreaterThanOrEqual(1);
      expect(result.response.draftOperations.some((op) => op.type === "insertHelperObject")).toBe(true);
      expect(result.response.draftOperations[0]?.source).toBe("agent");
      expect(result.response.draftOperations[0]?.status).toBe("preview");
    }
  });

  it("rejects invalid design plans that fail compile", () => {
    const result = parseModelAgentEditResponse(
      {
        designPlan: {
          actions: [{ kind: "add_surface" }],
        },
        summary: [],
        warnings: [],
        confidence: "medium",
      },
      {
        ...BASE_REQUEST,
        selectedNodes: [],
        selection: { selectedNodeIds: [], source: "click" },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("selected nodes");
    }
  });

  it("rejects style operations targeting nodes outside selection via raw ops", () => {
    const result = parseModelAgentEditResponse(
      {
        draftOperations: [
          {
            id: "style-outside",
            type: "style",
            pageKey: BASE_REQUEST.pageKey,
            target: { nodeId: "outside-node" },
            payload: { property: "opacity", value: "0.9" },
            createdAt: Date.now(),
            source: "agent",
            status: "preview",
          },
        ],
        summary: [],
        warnings: [],
        confidence: "medium",
      },
      BASE_REQUEST,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("draftOperations are not accepted");
    }
  });
});
