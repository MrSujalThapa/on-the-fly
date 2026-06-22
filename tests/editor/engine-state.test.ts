import { describe, expect, it } from "vitest";
import {
  applyOperation,
  approveDraftOperations,
  clearDraftAndPreview,
  createInitialEditorState,
  replayOperations,
  revertOperation,
  validateOperation,
  validateOperationForDom,
} from "../../src/editor/index.js";
import {
  createHideOperation,
  createMoveOperation,
  createStyleOperation,
  createTestSignature,
  PAGE_KEY,
} from "./fixtures.js";

describe("validation hardening", () => {
  it("rejects missing targets and invalid style properties", () => {
    const missingTarget = validateOperation(
      createStyleOperation({
        target: {},
      }),
    );
    expect(missingTarget.ok).toBe(false);

    const invalidStyle = validateOperation({
      ...createStyleOperation(),
      payload: {
        property: "not-a-style-prop",
        value: "red",
      },
    } as unknown as ReturnType<typeof createStyleOperation>);
    expect(invalidStyle.ok).toBe(false);
  });

  it("rejects unsupported DOM operations and nodeId-only targets", () => {
    // `ungroup` is a valid editor operation but is not applicable to the DOM.
    const unsupported = validateOperationForDom({
      ...createHideOperation(),
      type: "ungroup",
      payload: { groupId: "group-1" },
    });

    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) {
      expect(unsupported.codes).toContain("unsupported_dom_operation");
    }

    const nodeOnly = validateOperationForDom(
      createStyleOperation({
        target: { nodeId: "node-1" },
      }),
    );
    expect(nodeOnly.ok).toBe(false);
    if (!nodeOnly.ok) {
      expect(nodeOnly.codes).toContain("missing_target");
    }
  });

  it("rejects invalid signatures on targets", () => {
    const result = validateOperation(
      createStyleOperation({
        target: {
          signature: createTestSignature({ cssPath: ":root", tagName: "div" }),
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.codes).toContain("dangerous_selector");
    }
  });
});

describe("engine state separation", () => {
  it("keeps draft, preview, and approved operations isolated", () => {
    let state = createInitialEditorState(PAGE_KEY);

    state = applyOperation(state, createStyleOperation({ id: "approved", status: "approved" }));
    state = applyOperation(state, createStyleOperation({ id: "draft", status: "draft" }));
    state = applyOperation(state, createHideOperation({ id: "preview", status: "preview" }));

    expect(state.approvedOperations).toHaveLength(1);
    expect(state.draftOperations).toHaveLength(1);
    expect(state.previewOperations).toHaveLength(1);

    state = clearDraftAndPreview(state);
    expect(state.draftOperations).toHaveLength(0);
    expect(state.previewOperations).toHaveLength(0);
    expect(state.approvedOperations).toHaveLength(1);

    state = applyOperation(state, createStyleOperation({ id: "draft-2", status: "draft" }));
    state = approveDraftOperations(state);
    expect(state.draftOperations).toHaveLength(0);
    expect(state.approvedOperations).toHaveLength(2);
  });

  it("replays and reverts operations in deterministic order", () => {
    const operations = [
      createStyleOperation({ id: "op-1" }),
      createMoveOperation({ id: "op-2" }),
      createHideOperation({ id: "op-3" }),
    ];

    const replayed = replayOperations(PAGE_KEY, operations);
    expect(replayed.approvedOperations.map((operation) => operation.id)).toEqual([
      "op-1",
      "op-2",
      "op-3",
    ]);

    let state = replayed;
    for (const operation of [...operations].reverse()) {
      state = revertOperation(state, operation);
    }

    expect(state.approvedOperations).toHaveLength(0);
  });
});
