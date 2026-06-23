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

  it("rejects duplicate operations", () => {
    const result = parseModelAgentEditResponse(
      {
        draftOperations: [
          {
            id: "dup-1",
            type: "duplicate",
            pageKey: BASE_REQUEST.pageKey,
            target: { nodeId: "node-1" },
            payload: { html: "<div>x</div>" },
            createdAt: Date.now(),
            source: "agent",
            status: "preview",
          },
        ],
        summary: ["Should fail"],
        warnings: [],
        confidence: "low",
      },
      BASE_REQUEST,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("duplicate");
      expect(result.code).toBe("unsafe_model_output");
    }
  });

  it("rejects raw HTML in text payloads", () => {
    const result = parseModelAgentEditResponse(
      {
        draftOperations: [
          {
            id: "text-1",
            type: "text",
            pageKey: BASE_REQUEST.pageKey,
            target: {
              nodeId: "node-1",
              signature: {
                cssPath: "main article.card",
                tagName: "article",
                classList: [],
                boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
              },
            },
            payload: { value: "<script>alert(1)</script>", preserveFormat: true },
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
      expect(result.code).toBe("unsafe_model_output");
    }
  });

  it("rejects script tags anywhere in model output", () => {
    const result = parseModelAgentEditResponse(
      {
        draftOperations: [],
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

  it("accepts a valid structured helper-object response", () => {
    const operation = createInsertHelperObjectOperation({
      source: "agent",
      status: "preview",
    });

    const result = parseModelAgentEditResponse(
      {
        draftOperations: [operation],
        summary: ["Added one background panel behind the selection."],
        warnings: [],
        confidence: "high",
      },
      BASE_REQUEST,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response.draftOperations).toHaveLength(1);
      expect(result.response.draftOperations[0]?.type).toBe("insertHelperObject");
      expect(result.response.draftOperations[0]?.source).toBe("agent");
      expect(result.response.draftOperations[0]?.status).toBe("preview");
    }
  });

  it("rejects operations targeting nodes outside selection context", () => {
    const operation = createInsertHelperObjectOperation({
      source: "agent",
      status: "preview",
    });

    const styleOperation = {
      id: "style-outside",
      type: "style",
      pageKey: BASE_REQUEST.pageKey,
      target: {
        nodeId: "outside-node",
        signature: {
          cssPath: "footer p",
          tagName: "p",
          classList: [],
          boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
        },
      },
      payload: { property: "opacity", value: "0.9" },
      createdAt: Date.now(),
      source: "agent",
      status: "preview",
    };

    const result = parseModelAgentEditResponse(
      {
        draftOperations: [operation, styleOperation],
        summary: ["Mixed ops"],
        warnings: [],
        confidence: "medium",
      },
      BASE_REQUEST,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("outside-node");
    }
  });
});
