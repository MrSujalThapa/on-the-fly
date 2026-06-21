import { describe, expect, it } from "vitest";
import {
  commitBatch,
  createBatchFromOperations,
  createEditorHistory,
  createInitialEditorState,
  redo,
  undo,
} from "../../src/editor/index.js";
import { createHideOperation, createStyleOperation, PAGE_KEY } from "./fixtures.js";

describe("history manager", () => {
  it("records batches on the undo stack", () => {
    const state = createInitialEditorState(PAGE_KEY);
    const history = createEditorHistory();
    const batch = createBatchFromOperations(
      "batch-1",
      [createStyleOperation({ id: "op-1" })],
      Date.now(),
    );

    const committed = commitBatch(state, history, batch);

    expect(committed.history.undoStack).toHaveLength(1);
    expect(committed.history.redoStack).toHaveLength(0);
    expect(committed.state.approvedOperations).toHaveLength(1);
  });

  it("undoes and redoes the last batch", () => {
    const state = createInitialEditorState(PAGE_KEY);
    const history = createEditorHistory();
    const batch = createBatchFromOperations(
      "batch-1",
      [createStyleOperation({ id: "op-1" }), createHideOperation({ id: "op-2" })],
      Date.now(),
    );

    const committed = commitBatch(state, history, batch);
    const undone = undo(committed.history, committed.state);
    expect(undone).not.toBeNull();
    if (!undone) {
      return;
    }

    expect(undone.state.approvedOperations).toHaveLength(0);
    expect(undone.history.redoStack).toHaveLength(1);

    const redone = redo(undone.history, undone.state);
    expect(redone?.state.approvedOperations).toHaveLength(2);
    expect(redone?.history.undoStack).toHaveLength(1);
  });
});
