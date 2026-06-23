import { describe, expect, it } from "vitest";
import { buildAgentEditRequest, computeSelectionBoundsFromContext } from "../../../src/content/agent/context-builder.js";
import {
  assertAgentVisualNodeIsDomFree,
  toAgentVisualNode,
} from "../../../src/content/agent/visual-node-serializer.js";
import { createTestSignature } from "../../editor/fixtures.js";
import type { VisualNode } from "../../../src/editor/visual-node.js";
import { VisualLayoutGraph } from "../../../src/editor/visual-graph/visual-layout-graph.js";
import { createStyleOperation } from "../../editor/fixtures.js";

function createVisualNode(overrides: Partial<VisualNode> = {}): VisualNode {
  const element = document.createElement("p");
  return {
    id: "node-1",
    kind: "text",
    signature: createTestSignature(),
    rect: { x: 10, y: 20, width: 100, height: 40 },
    computed: { color: "rgb(0, 0, 0)" },
    childIds: [],
    element,
    ...overrides,
  };
}

function createGraph(nodes: VisualNode[]): VisualLayoutGraph {
  return new VisualLayoutGraph({
    nodes: new Map(nodes.map((node) => [node.id, node])),
    rootNodeIds: nodes.map((node) => node.id),
    viewport: { width: 1280, height: 720 },
    builtAt: 1,
    version: 1,
  });
}

describe("agent context builder", () => {
  it("strips DOM elements before serialization", () => {
    const node = createVisualNode();
    const serialized = toAgentVisualNode(node);

    expect("element" in serialized).toBe(false);
    expect(assertAgentVisualNodeIsDomFree(serialized)).toBe(true);
  });

  it("builds requests with selected, nearby, and relevant operations only", () => {
    const selected = createVisualNode({ id: "node-selected" });
    const nearby = createVisualNode({
      id: "node-nearby",
      rect: { x: 120, y: 20, width: 80, height: 40 },
    });
    const graph = createGraph([selected, nearby]);
    const savedForSelection = createStyleOperation({
      id: "saved-selected",
      target: { nodeId: "node-selected", signature: selected.signature },
      status: "approved",
    });
    const savedForOther = createStyleOperation({
      id: "saved-other",
      target: { nodeId: "node-other", signature: createTestSignature({ cssPath: "aside" }) },
      status: "approved",
    });
    const previewOp = createStyleOperation({
      id: "preview-op",
      status: "preview",
      target: { nodeId: "node-selected", signature: selected.signature },
    });

    const request = buildAgentEditRequest({
      pageKey: "https://example.com/",
      instruction: "Make this card feel premium.",
      selection: { selectedNodeIds: ["node-selected"], source: "click" },
      selectedNodes: [selected],
      graph,
      existingOperations: [savedForSelection, savedForOther, previewOp],
    });

    expect(request.selectedNodes.every((node) => assertAgentVisualNodeIsDomFree(node))).toBe(true);
    expect(request.nearbyNodes.map((node) => node.id)).toEqual(["node-nearby"]);
    expect(request.existingOperations.map((operation) => operation.id)).toEqual(["saved-selected"]);
  });

  it("includes every selected node when building grouped agent context", () => {
    const first = createVisualNode({ id: "node-a", rect: { x: 10, y: 20, width: 100, height: 40 } });
    const second = createVisualNode({
      id: "node-b",
      rect: { x: 10, y: 70, width: 100, height: 40 },
      signature: createTestSignature({ cssPath: "main p.second" }),
    });
    const graph = createGraph([first, second]);

    const request = buildAgentEditRequest({
      pageKey: "https://example.com/",
      instruction: "Add a gradient panel behind this group",
      selection: {
        selectedNodeIds: ["node-a", "node-b"],
        activeGroupId: "group-1",
        source: "group",
      },
      selectedNodes: [first, second],
      graph,
      existingOperations: [],
    });

    expect(request.selectedNodes.map((node) => node.id)).toEqual(["node-a", "node-b"]);
    expect(request.selection.activeGroupId).toBe("group-1");
  });

  it("computes grouped bounds from every member node", () => {
    const first = createVisualNode({ id: "node-a", rect: { x: 10, y: 20, width: 100, height: 40 } });
    const second = createVisualNode({
      id: "node-b",
      rect: { x: 140, y: 80, width: 80, height: 40 },
      signature: createTestSignature({ cssPath: "main p.second" }),
    });
    const graph = createGraph([first, second]);

    const bounds = computeSelectionBoundsFromContext({
      pageKey: "https://example.com/",
      instruction: "Group edit",
      selection: {
        selectedNodeIds: ["node-a", "node-b"],
        activeGroupId: "group-1",
        source: "group",
      },
      selectedNodes: [first, second],
      graph,
      existingOperations: [],
    });

    expect(bounds).toEqual({ x: 10, y: 20, width: 210, height: 100 });
  });
});
