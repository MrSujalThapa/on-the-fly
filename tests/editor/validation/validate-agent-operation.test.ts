import { describe, expect, it } from "vitest";
import type { DuplicateOperation } from "../../../src/editor/operations.js";
import {
  validateAgentOperation,
  validateAgentOperations,
} from "../../../src/editor/validation/validate-agent-operation.js";
import { buildAgentScopeContext } from "../../../src/editor/validation/validate-agent-scope.js";
import {
  createInsertHelperObjectOperation,
  createStyleOperation,
  createTestSignature,
  createTestTarget,
} from "../fixtures.js";

const TEST_SCOPE = buildAgentScopeContext({
  selectedNodeIds: ["node-1"],
  nearbyNodeIds: ["node-2"],
  selectionBounds: { x: 0, y: 0, width: 120, height: 40 },
});

describe("validateAgentOperation", () => {
  it("accepts structured agent draft operations", () => {
    const result = validateAgentOperation(
      createStyleOperation({
        source: "agent",
        status: "draft",
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]?.source).toBe("agent");
    }
  });

  it("allows valid helper object draft and preview operations", () => {
    const draft = validateAgentOperation(
      createInsertHelperObjectOperation({
        source: "agent",
        status: "draft",
      }),
    );
    const preview = validateAgentOperation(
      createInsertHelperObjectOperation({
        id: "op-helper-preview",
        source: "agent",
        status: "preview",
      }),
    );

    expect(draft.ok).toBe(true);
    expect(preview.ok).toBe(true);
  });

  it("rejects duplicate because it carries raw HTML", () => {
    const duplicate: DuplicateOperation = {
      id: "agent-duplicate",
      type: "duplicate",
      pageKey: "https://example.com/",
      target: createTestTarget(),
      payload: {
        cloneId: "clone-1",
        html: "<div>raw</div>",
        parentCssPath: "body",
        offsetDx: 0,
        offsetDy: 0,
        anchorLeft: 0,
        anchorTop: 0,
        anchorWidth: 100,
        anchorHeight: 50,
        styleSnapshot: {},
      },
      createdAt: 1_700_000_000_000,
      source: "agent",
      status: "draft",
    };

    const result = validateAgentOperation(duplicate);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("duplicate");
      expect(result.codes).toContain("unsupported_dom_operation");
    }
  });

  it("rejects unknown operation types", () => {
    const result = validateAgentOperation({
      ...createStyleOperation({ source: "agent", status: "draft" }),
      type: "warp",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("unknown_type");
    }
  });

  it("rejects dangerous global targets", () => {
    const result = validateAgentOperation(
      createStyleOperation({
        source: "agent",
        status: "draft",
        target: {
          nodeId: "html-node",
          signature: createTestSignature({
            cssPath: "html",
            tagName: "html",
            classList: [],
          }),
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("dangerous_selector");
    }
  });

  it("rejects approved operations from agent output", () => {
    const result = validateAgentOperations([
      createStyleOperation({
        source: "agent",
        status: "approved",
      }),
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("invalid_status");
    }
  });

  it("rejects operations outside selected scope when scope context is provided", () => {
    const result = validateAgentOperations(
      [
        createStyleOperation({
          source: "agent",
          status: "preview",
          target: createTestTarget({ nodeId: "node-99" }),
        }),
      ],
      TEST_SCOPE,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("out_of_scope");
    }
  });
});
