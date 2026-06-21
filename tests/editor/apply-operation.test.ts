import { describe, expect, it } from "vitest";
import {
  applyOperation,
  createInitialEditorState,
  replayOperations,
  revertOperation,
  validateOperation,
} from "../../src/editor/index.js";
import { createHideOperation, createStyleOperation, createTestSignature, PAGE_KEY } from "./fixtures.js";

describe("validateOperation", () => {
  it("accepts a valid style operation", () => {
    const result = validateOperation(createStyleOperation());
    expect(result.ok).toBe(true);
  });

  it("rejects dangerous selectors", () => {
    const result = validateOperation(
      createStyleOperation({
        target: {
          nodeId: "node-danger",
          signature: createTestSignature({ cssPath: "body", tagName: "body" }),
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("dangerous"))).toBe(true);
  });

  it("rejects unknown operation types", () => {
    const invalid = {
      ...createStyleOperation(),
      type: "unknown",
    } as unknown as ReturnType<typeof createStyleOperation>;

    const result = validateOperation(invalid);
    expect(result.ok).toBe(false);
  });
});

describe("applyOperation", () => {
  it("stores approved operations separately from draft operations", () => {
    const initial = createInitialEditorState(PAGE_KEY);
    const approved = createStyleOperation({ id: "approved-1", status: "approved" });
    const draft = createStyleOperation({ id: "draft-1", status: "draft" });

    const afterApproved = applyOperation(initial, approved);
    const afterDraft = applyOperation(afterApproved, draft);

    expect(afterDraft.approvedOperations).toHaveLength(1);
    expect(afterDraft.draftOperations).toHaveLength(1);
    expect(afterDraft.previewOperations).toHaveLength(0);
  });

  it("reverts an applied operation", () => {
    const operation = createHideOperation();
    const applied = applyOperation(createInitialEditorState(PAGE_KEY), operation);
    const reverted = revertOperation(applied, operation);

    expect(reverted.approvedOperations).toHaveLength(0);
  });

  it("replays operations in order", () => {
    const first = createStyleOperation({ id: "op-1" });
    const second = createHideOperation({ id: "op-2" });
    const replayed = replayOperations(PAGE_KEY, [first, second]);

    expect(replayed.approvedOperations.map((operation) => operation.id)).toEqual(["op-1", "op-2"]);
  });
});
