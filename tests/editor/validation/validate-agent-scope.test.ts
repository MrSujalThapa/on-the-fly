import { describe, expect, it } from "vitest";
import {
  buildAgentScopeContext,
  validateAgentOperationsScope,
} from "../../../src/editor/validation/validate-agent-scope.js";
import {
  createInsertHelperObjectOperation,
  createMoveOperation,
  createStyleOperation,
} from "../fixtures.js";

const BASE_SCOPE = buildAgentScopeContext({
  selectedNodeIds: ["node-1"],
  nearbyNodeIds: ["node-2"],
  selectionBounds: { x: 40, y: 40, width: 160, height: 80 },
  pageLevelNodeIds: ["page-root"],
});

describe("validateAgentOperationsScope", () => {
  it("rejects style operations outside selected/nearby node ids", () => {
    const errors = validateAgentOperationsScope(
      [
        createStyleOperation({
          source: "agent",
          status: "preview",
          target: { nodeId: "node-99" },
        }),
      ],
      BASE_SCOPE,
    );

    expect(errors.join(" ")).toContain("outside selected/nearby scope");
  });

  it("rejects helper objects too far from selected bounds", () => {
    const errors = validateAgentOperationsScope(
      [
        createInsertHelperObjectOperation({
          source: "agent",
          status: "preview",
          payload: {
            ...createInsertHelperObjectOperation().payload,
            rect: { x: 1200, y: 1200, width: 120, height: 80 },
          },
        }),
      ],
      BASE_SCOPE,
    );

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toMatch(/far from selected bounds|outside selected bounds/);
  });

  it("allows helper panels near the selected bounds", () => {
    const errors = validateAgentOperationsScope(
      [
        createInsertHelperObjectOperation({
          source: "agent",
          status: "preview",
          payload: {
            ...createInsertHelperObjectOperation().payload,
            rect: { x: 20, y: 20, width: 220, height: 120 },
            zIndex: 2,
          },
        }),
      ],
      BASE_SCOPE,
    );

    expect(errors).toEqual([]);
  });

  it("rejects page-level targets that were not explicitly selected", () => {
    const errors = validateAgentOperationsScope(
      [
        createMoveOperation({
          source: "agent",
          status: "preview",
          target: { nodeId: "page-root" },
        }),
      ],
      BASE_SCOPE,
    );

    expect(errors.join(" ")).toContain("page-level container");
  });
});
