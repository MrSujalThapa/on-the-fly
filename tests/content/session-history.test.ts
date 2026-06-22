import { describe, expect, it } from "vitest";
import { createStyleOperation } from "../editor/fixtures.js";
import {
  appendOperations,
  canRedo,
  canUndo,
  createSessionHistory,
  popRedoBatch,
  popUndoBatch,
  recordHistoryBatch,
  removeOperationsById,
} from "../../src/content/session-history.js";

describe("session history", () => {
  it("records undo batches and supports undo/redo stacks", () => {
    const op = createStyleOperation({ id: "op-1" });
    let history = createSessionHistory();
    history = recordHistoryBatch(history, [op]);

    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);

    const undone = popUndoBatch(history);
    expect(undone.batch?.[0]?.id).toBe("op-1");
    expect(canUndo(undone.history)).toBe(false);
    expect(canRedo(undone.history)).toBe(true);

    const redone = popRedoBatch(undone.history);
    expect(redone.batch?.[0]?.id).toBe("op-1");
    expect(canUndo(redone.history)).toBe(true);
  });

  it("removes operations by id for persistence sync", () => {
    const left = createStyleOperation({ id: "keep" });
    const right = createStyleOperation({ id: "drop" });
    const next = removeOperationsById(appendOperations([left], [right]), new Set(["drop"]));
    expect(next.map((operation) => operation.id)).toEqual(["keep"]);
  });
});
