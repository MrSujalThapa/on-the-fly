import { describe, expect, it } from "vitest";
import {
  applyContextBudget,
  CONTEXT_BUDGET_LIMITS,
} from "../../agent-server/src/context-budget.js";
import type { AgentEditRequest } from "../../src/shared/agent-contracts.js";
import { createStyleOperation } from "../editor/fixtures.js";

function createLargeRequest(nodeCount: number): AgentEditRequest {
  const selectedNodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${String(index)}`,
    kind: "text" as const,
    signature: {
      cssPath: `main section:nth-child(${String(index + 1)}) p.copy`,
      tagName: "p",
      classList: ["copy", "line", "extra", "more", "classes", "overflow", "here", "and", "more"],
      boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
    },
    rect: { x: index, y: index, width: 100, height: 20 },
    computed: {
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgb(255, 255, 255)",
      fontSize: "16px",
      fontWeight: "400",
      borderRadius: "0px",
      opacity: "1",
      transform: "none",
      overflow: "visible",
      display: "block",
      position: "static",
      zIndex: "auto",
      textAlign: "left",
      filter: "none",
    },
    childIds: [],
  }));

  return {
    pageKey: "https://example.com/",
    instruction: "x".repeat(CONTEXT_BUDGET_LIMITS.maxInstructionLength + 40),
    selection: { selectedNodeIds: selectedNodes.map((node) => node.id), source: "click" },
    selectedNodes,
    nearbyNodes: selectedNodes.slice(0, 20),
    existingOperations: Array.from({ length: 30 }, (_, index) =>
      createStyleOperation({ id: `op-${String(index)}` }),
    ),
    screenshotCropDataUrl: "data:image/png;base64,abc",
  };
}

describe("context budget", () => {
  it("caps selected nodes, nearby nodes, operations, and instruction length", () => {
    const budgeted = applyContextBudget(createLargeRequest(20));

    expect(budgeted.request.selectedNodes.length).toBe(CONTEXT_BUDGET_LIMITS.maxSelectedNodes);
    expect(budgeted.request.nearbyNodes.length).toBe(CONTEXT_BUDGET_LIMITS.maxNearbyNodes);
    expect(budgeted.request.existingOperations.length).toBe(
      CONTEXT_BUDGET_LIMITS.maxExistingOperations,
    );
    expect(budgeted.request.instruction.length).toBeLessThanOrEqual(
      CONTEXT_BUDGET_LIMITS.maxInstructionLength,
    );
    expect(budgeted.request.screenshotCropDataUrl).toBeUndefined();
    expect(budgeted.budget.selectedNodes.truncated).toBe(12);
    expect(budgeted.budget.nearbyNodes.truncated).toBe(14);
    expect(budgeted.budget.instructionTruncated).toBe(true);
    expect(budgeted.budget.screenshotIncluded).toBe(false);
    expect(budgeted.request.selectedNodes[0]?.signature.classList).toEqual([]);
  });

  it("limits style fields sent for each node", () => {
    const budgeted = applyContextBudget(createLargeRequest(1));
    expect(Object.keys(budgeted.request.selectedNodes[0]?.computed ?? {}).length).toBeLessThanOrEqual(
      CONTEXT_BUDGET_LIMITS.maxStyleFields,
    );
  });
});
