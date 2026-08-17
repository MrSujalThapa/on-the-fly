import { describe, expect, it } from "vitest";
import type { MoveOperation } from "../../src/editor/operations.js";
import { createOperationLedger } from "../../src/runtime-v2/create-operation-ledger.js";

function move(id: string): MoveOperation {
  return {
    id,
    type: "move",
    pageKey: "https://example.com/",
    target: {
      signature: {
        cssPath: "article",
        tagName: "article",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
    },
    payload: { dx: 10, dy: 0 },
    createdAt: 1,
    source: "manual",
    status: "draft",
  };
}

describe("OperationLedger", () => {
  it("derives active operations, undo/redo, and dirty from one cursor", () => {
    const ledger = createOperationLedger();
    expect(ledger.activeOperations()).toEqual([]);
    expect(ledger.canUndo()).toBe(false);
    expect(ledger.isDirty()).toBe(false);

    ledger.commit(move("a"));
    ledger.commit(move("b"));
    expect(ledger.activeOperations().map((operation) => operation.id)).toEqual(["a", "b"]);
    expect(ledger.isDirty()).toBe(true);
    expect(ledger.canUndo()).toBe(true);

    ledger.markPersisted();
    expect(ledger.isDirty()).toBe(false);

    const undone = ledger.confirmUndo();
    expect(undone?.id).toBe("b");
    expect(ledger.activeOperations().map((operation) => operation.id)).toEqual(["a"]);
    expect(ledger.isDirty()).toBe(true);
    expect(ledger.canRedo()).toBe(true);

    const redone = ledger.confirmRedo();
    expect(redone?.id).toBe("b");
    expect(ledger.isDirty()).toBe(false);
  });

  it("truncates the redo tail on a new commit", () => {
    const ledger = createOperationLedger();
    ledger.commit(move("a"));
    ledger.commit(move("b"));
    ledger.confirmUndo();
    ledger.commit(move("c"));

    expect(ledger.activeOperations().map((operation) => operation.id)).toEqual(["a", "c"]);
    expect(ledger.canRedo()).toBe(false);
    expect(ledger.entries).toHaveLength(2);
  });

  it("does not advance persisted revision on its own", () => {
    const ledger = createOperationLedger();
    ledger.commit(move("a"));
    expect(ledger.persistedRevision).toBe(0);
    expect(ledger.isDirty()).toBe(true);
    ledger.markPersisted();
    expect(ledger.persistedRevision).toBe(1);
  });

  it("hydrates as a persisted projection", () => {
    const ledger = createOperationLedger();
    ledger.hydratePersisted([move("saved")]);
    expect(ledger.activeOperations()).toHaveLength(1);
    expect(ledger.isDirty()).toBe(false);
    expect(ledger.persistedRevision).toBe(1);
  });
});
