import { describe, expect, it } from "vitest";
import type { AgentEditRequest } from "../../../src/shared/agent-contracts.js";
import {
  normalizeAgentDraftOperations,
  normalizeInsertHelperObjectForAgentRequest,
  prepareAgentDraftOperations,
} from "../../../src/editor/agent/normalize-helper-object-operation.js";
import { parseModelAgentEditResponse } from "../../../agent-server/src/response-validation.js";

const SINGLE_REQUEST: AgentEditRequest = {
  pageKey: "https://example.com/",
  instruction: "add a subtle gradient panel behind this",
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

const GROUP_REQUEST: AgentEditRequest = {
  ...SINGLE_REQUEST,
  instruction: "add a subtle gradient panel behind this group",
  selection: {
    selectedNodeIds: ["node-1", "node-2"],
    activeGroupId: "group-1",
    source: "group",
  },
  selectedNodes: [
    SINGLE_REQUEST.selectedNodes[0] as AgentEditRequest["selectedNodes"][number],
    {
      id: "node-2",
      kind: "text",
      signature: {
        cssPath: "main article.card p",
        tagName: "p",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 50, y: 90, width: 140, height: 28 },
      computed: {},
      childIds: [],
    },
  ],
};

describe("normalizeInsertHelperObjectForAgentRequest", () => {
  it("builds a valid gradient helper target for a single selected element", () => {
    const parsed = parseModelAgentEditResponse(
      {
        draftOperations: [
          {
            type: "insertHelperObject",
            payload: {
              role: "backgroundPanel",
              fill: {
                type: "linearGradient",
                angleDeg: 135,
                stops: [
                  { color: "#ffffff", position: 0 },
                  { color: "#eef2ff", position: 100 },
                ],
              },
            },
          },
        ],
        summary: ["Added gradient panel."],
        warnings: [],
        confidence: "high",
      },
      SINGLE_REQUEST,
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const operation = parsed.response.draftOperations[0];
      expect(operation?.target.nodeId).toBeTruthy();
      expect(operation?.target.signature?.cssPath).toContain("#otf-helper-");
      expect(operation?.target.nodeId).not.toBe("node-1");
    }
  });

  it("anchors helper objects to grouped selection scope", () => {
    const prepared = prepareAgentDraftOperations(
      [
        {
          type: "insertHelperObject",
          target: { nodeId: "node-2" },
          payload: {
            helperId: "group-panel",
            role: "backgroundPanel",
            rect: { x: 10, y: 10, width: 10, height: 10 },
          },
        },
      ],
      GROUP_REQUEST,
    );

    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      const operation = prepared.operations[0] as {
        target: { nodeId: string; groupId?: string };
        payload: { rect: { width: number; height: number } };
      };
      expect(operation.target.nodeId).toBe("group-panel");
      expect(operation.target.groupId).toBe("group-1");
      expect(operation.payload.rect.width).toBeGreaterThan(100);
      expect(operation.payload.rect.height).toBeGreaterThan(80);
    }
  });

  it("rejects helper generation when selected scope is missing", () => {
    const result = normalizeInsertHelperObjectForAgentRequest(
      { type: "insertHelperObject", payload: { role: "backgroundPanel" } },
      { ...SINGLE_REQUEST, selectedNodes: [] },
      0,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("cannot resolve helper object target");
    }
  });

  it("rejects invalid helper geometry instead of silently repairing it", () => {
    const result = normalizeInsertHelperObjectForAgentRequest(
      {
        type: "insertHelperObject",
        payload: {
          role: "backgroundPanel",
          rect: { x: 0, y: 0, width: -10, height: 10 },
        },
      },
      SINGLE_REQUEST,
      0,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("zero or negative dimensions");
    }
  });
});

describe("parseModelAgentEditResponse helper normalization", () => {
  it("accepts model helper output missing target and normalizes it safely", () => {
    const parsed = parseModelAgentEditResponse(
      {
        draftOperations: [
          {
            type: "insertHelperObject",
            payload: {
              role: "backgroundPanel",
              fill: {
                type: "linearGradient",
                angleDeg: 135,
                stops: [
                  { color: "#ffffff", position: 0 },
                  { color: "#dbeafe", position: 100 },
                ],
              },
              borderRadius: "18px",
              opacity: 0.95,
              zIndex: 1,
            },
          },
        ],
        summary: ["Added gradient panel."],
        warnings: [],
        confidence: "high",
      },
      SINGLE_REQUEST,
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.response.draftOperations[0]?.target.signature?.cssPath).toContain("#otf-helper-");
    }
  });

  it("rejects missing target when selected scope cannot be resolved", () => {
    const parsed = parseModelAgentEditResponse(
      {
        draftOperations: [{ type: "insertHelperObject", payload: { role: "backgroundPanel" } }],
        summary: [],
        warnings: [],
        confidence: "low",
      },
      { ...SINGLE_REQUEST, selectedNodes: [] },
    );

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.join(" ")).toContain("cannot resolve helper object target");
    }
  });
});

describe("normalizeAgentDraftOperations", () => {
  it("does not mutate non-helper operations", () => {
    const result = normalizeAgentDraftOperations(
      [
        {
          type: "style",
          target: { nodeId: "node-1" },
          payload: { property: "opacity", value: "0.9" },
        },
      ],
      SINGLE_REQUEST,
    );

    expect(result.ok).toBe(true);
  });
});
