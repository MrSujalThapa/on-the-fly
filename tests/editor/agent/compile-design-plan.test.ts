import { describe, expect, it } from "vitest";
import { compileDesignPlan } from "../../../src/editor/agent/compile-design-plan.js";
import { validateAgentOperations } from "../../../src/editor/validation/validate-agent-operation.js";
import { buildAgentScopeContext } from "../../../src/editor/validation/validate-agent-scope.js";
import type { AgentEditRequest } from "../../../src/shared/agent-contracts.js";
import { prepareAgentDraftOperations } from "../../../src/editor/agent/normalize-helper-object-operation.js";

const SINGLE_NODE_REQUEST: AgentEditRequest = {
  pageKey: "https://example.com/",
  instruction: "Add a subtle gradient panel behind this.",
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
  ...SINGLE_NODE_REQUEST,
  instruction: "Make this group feel premium.",
  selection: {
    selectedNodeIds: ["node-1", "node-2"],
    activeGroupId: "group-1",
    source: "group",
  },
  selectedNodes: [
    SINGLE_NODE_REQUEST.selectedNodes[0] as AgentEditRequest["selectedNodes"][number],
    {
      id: "node-2",
      kind: "text",
      signature: {
        cssPath: "main article.card p",
        tagName: "p",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 50, y: 90, width: 160, height: 40 },
      computed: {},
      childIds: [],
    },
  ],
};

function compileAndValidate(request: AgentEditRequest, plan: Parameters<typeof compileDesignPlan>[0]) {
  const compiled = compileDesignPlan(plan, request);
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) {
    return compiled;
  }

  const prepared = prepareAgentDraftOperations(compiled.operations, request);
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) {
    return prepared;
  }

  const scope = buildAgentScopeContext({
    selectedNodeIds: request.selection.selectedNodeIds,
    nearbyNodeIds: request.nearbyNodes.map((node) => node.id),
    selectionBounds: { x: 40, y: 60, width: 190, height: 70 },
  });

  return validateAgentOperations(prepared.operations, scope);
}

describe("compileDesignPlan", () => {
  it("compiles add_surface gradient plan to valid insertHelperObject", () => {
    const validation = compileAndValidate(SINGLE_NODE_REQUEST, {
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
    });

    expect(validation.ok).toBe(true);
    if (validation.ok) {
      const helpers = validation.operations.filter((op) => op.type === "insertHelperObject");
      expect(helpers.length).toBeGreaterThanOrEqual(1);
      const helper = helpers[0];
      if (helper?.type === "insertHelperObject") {
        expect(helper.payload.role).toBe("backgroundPanel");
        expect(helper.payload.fill?.type).toBe("linearGradient");
        expect(helper.target.nodeId).toBe(helper.payload.helperId);
        expect(helper.target.signature?.cssPath).toMatch(/^#otf-helper-/);
      }
    }
  });

  it("compiles adjust_elevation to valid style and zIndex operations", () => {
    const validation = compileAndValidate(SINGLE_NODE_REQUEST, {
      actions: [
        {
          kind: "adjust_elevation",
          params: { shadow: "medium", intensity: "moderate" },
        },
      ],
    });

    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.operations.some((op) => op.type === "style")).toBe(true);
      expect(validation.operations.some((op) => op.type === "zIndex")).toBe(true);
      const styleOp = validation.operations.find((op) => op.type === "style");
      if (styleOp?.type === "style") {
        expect(styleOp.payload.property).toBe("boxShadow");
      }
    }
  });

  it("compiles group selection using group target and full group bounds", () => {
    const compiled = compileDesignPlan(
      {
        actions: [{ kind: "add_surface", params: { placement: "behind", fill: "gradient", mood: "premium" } }],
      },
      GROUP_REQUEST,
    );

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    const helper = compiled.operations[0];
    expect(helper?.type).toBe("insertHelperObject");
    if (helper?.type === "insertHelperObject") {
      expect(helper.target.groupId).toBe("group-1");
      expect(helper.payload.rect.x).toBeLessThanOrEqual(40);
      expect(helper.payload.rect.width).toBeGreaterThanOrEqual(180);
      expect(helper.payload.rect.height).toBeGreaterThanOrEqual(70);
    }
  });

  it("never emits invalid helper roles", () => {
    const validation = compileAndValidate(SINGLE_NODE_REQUEST, {
      actions: [
        { kind: "add_surface", params: { fill: "gradient" } },
        { kind: "emphasize_section", params: { mood: "premium", shadow: "medium" } },
      ],
    });

    expect(validation.ok).toBe(true);
    if (validation.ok) {
      for (const operation of validation.operations) {
        if (operation.type === "insertHelperObject") {
          expect(["backgroundPanel", "decorativePanel", "highlightBox"]).toContain(operation.payload.role);
        }
      }
    }
  });
});
