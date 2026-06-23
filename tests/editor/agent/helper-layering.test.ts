import { describe, expect, it } from "vitest";
import {
  applyScopeLayeringToOperations,
  resolveScopeLayering,
} from "../../../src/editor/agent/helper-layering.js";
import type { AgentEditRequest } from "../../../src/shared/agent-contracts.js";

const BASE_REQUEST: AgentEditRequest = {
  pageKey: "https://example.com/",
  instruction: "Add panel",
  selection: { selectedNodeIds: ["node-1"], source: "click" },
  selectedNodes: [
    {
      id: "node-1",
      kind: "container",
      signature: {
        cssPath: "#card",
        tagName: "article",
        classList: ["card"],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 40, y: 60, width: 180, height: 120 },
      computed: { zIndex: "2" },
      childIds: [],
    },
  ],
  nearbyNodes: [],
  existingOperations: [],
};

describe("helper layering", () => {
  it("places helper panels below selected scope layer", () => {
    const plan = resolveScopeLayering(BASE_REQUEST);
    expect(plan.helperLayer).toBe(1);
    expect(plan.selectionLayer).toBeGreaterThan(plan.helperLayer);

    const operations = applyScopeLayeringToOperations(
      [
        {
          id: "helper-1",
          type: "insertHelperObject",
          pageKey: BASE_REQUEST.pageKey,
          target: { nodeId: "helper-1" },
          payload: {
            helperId: "helper-1",
            role: "backgroundPanel",
            rect: { x: 0, y: 0, width: 100, height: 100 },
            fill: { type: "solid", color: "#fff" },
            zIndex: 2,
          },
          createdAt: 1,
          source: "agent",
          status: "preview",
        },
      ],
      BASE_REQUEST,
      1,
    );

    const helper = operations.find((op) => op.type === "insertHelperObject");
    expect(helper?.type).toBe("insertHelperObject");
    if (helper?.type === "insertHelperObject") {
      expect(helper.payload.zIndex).toBe(1);
      expect(helper.payload.zIndex).toBeLessThan(plan.selectionLayer);
    }
  });

  it("lifts selected nodes above helper when needed", () => {
    const request: AgentEditRequest = {
      ...BASE_REQUEST,
      selectedNodes: [
        {
          ...BASE_REQUEST.selectedNodes[0] as AgentEditRequest["selectedNodes"][number],
          computed: { zIndex: "auto" },
        },
      ],
    };

    const operations = applyScopeLayeringToOperations(
      [
        {
          id: "helper-1",
          type: "insertHelperObject",
          pageKey: request.pageKey,
          target: { nodeId: "helper-1" },
          payload: {
            helperId: "helper-1",
            role: "backgroundPanel",
            rect: { x: 0, y: 0, width: 100, height: 100 },
            fill: { type: "solid", color: "#fff" },
          },
          createdAt: 1,
          source: "agent",
          status: "preview",
        },
      ],
      request,
      1,
    );

    const lift = operations.find((op) => op.type === "zIndex");
    expect(lift?.type).toBe("zIndex");
    if (lift?.type === "zIndex") {
      expect(lift.payload.layer).toBeGreaterThan(0);
      expect(lift.target.nodeId).toBe("node-1");
    }
  });
});
