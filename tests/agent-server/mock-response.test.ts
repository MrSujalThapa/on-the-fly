import { describe, expect, it } from "vitest";
import { buildMockAgentEditResponse } from "../../agent-server/src/mock-response.js";
import { validateAgentOperations } from "../../src/editor/validation/validate-agent-operation.js";
import type { AgentEditRequest } from "../../src/shared/agent-contracts.js";

const BASE_REQUEST: AgentEditRequest = {
  pageKey: "https://example.com/",
  instruction: "Add a soft background panel.",
  selection: { selectedNodeIds: ["node-1"], source: "click" },
  selectedNodes: [
    {
      id: "node-1",
      kind: "text",
      signature: {
        cssPath: "main p#copy",
        tagName: "p",
        classList: [],
        idAttr: "copy",
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 40, y: 60, width: 180, height: 48 },
      computed: {},
      childIds: [],
    },
  ],
  nearbyNodes: [],
  existingOperations: [],
};

describe("mock agent edit response", () => {
  it("returns one valid insertHelperObject preview operation", () => {
    const response = buildMockAgentEditResponse(BASE_REQUEST);
    const validation = validateAgentOperations(response.draftOperations);

    expect(validation.ok).toBe(true);
    expect(response.draftOperations.length).toBeGreaterThanOrEqual(1);
    expect(response.draftOperations.some((op) => op.type === "insertHelperObject")).toBe(true);
    expect(response.draftOperations[0]?.status).toBe("preview");
    expect(response.draftOperations[0]?.source).toBe("agent");
    expect(response.summary.length).toBeGreaterThan(0);
  });
});
