import { applyOperation } from "../engine/apply-operation.js";
import { revertOperation } from "../engine/apply-operation.js";
import type { EditorState } from "../editor-state.js";
import { createOperationBatch, type OperationBatch } from "../operation-batch.js";
import type { OperationBatchId } from "../ids.js";
import type { EditorOperation } from "../operations.js";
import { validateOperations } from "../validation/validate-operation.js";

export interface EditorHistory {
  undoStack: OperationBatch[];
  redoStack: OperationBatch[];
}

export interface HistoryApplyResult {
  state: EditorState;
  history: EditorHistory;
  batch: OperationBatch;
}

export interface HistoryUndoResult {
  state: EditorState;
  history: EditorHistory;
  batch: OperationBatch;
}

export interface HistoryRedoResult {
  state: EditorState;
  history: EditorHistory;
  batch: OperationBatch;
}

export function createEditorHistory(): EditorHistory {
  return {
    undoStack: [],
    redoStack: [],
  };
}

export function createBatchFromOperations(
  id: OperationBatchId,
  operations: EditorOperation[],
  createdAt: number,
  label?: string,
): OperationBatch {
  const validation = validateOperations(operations);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  return createOperationBatch(id, operations, createdAt, label);
}

export function applyBatchToState(state: EditorState, batch: OperationBatch): EditorState {
  return batch.operations.reduce(
    (current, operation) => applyOperation(current, operation),
    state,
  );
}

export function recordAppliedBatch(
  history: EditorHistory,
  batch: OperationBatch,
): EditorHistory {
  return {
    undoStack: [...history.undoStack, batch],
    redoStack: [],
  };
}

export function commitBatch(
  state: EditorState,
  history: EditorHistory,
  batch: OperationBatch,
): HistoryApplyResult {
  return {
    state: applyBatchToState(state, batch),
    history: recordAppliedBatch(history, batch),
    batch,
  };
}

export function undo(history: EditorHistory, state: EditorState): HistoryUndoResult | null {
  const batch = history.undoStack.at(-1);
  if (!batch) {
    return null;
  }

  let nextState = state;
  for (const operation of [...batch.operations].reverse()) {
    nextState = revertOperation(nextState, operation);
  }

  return {
    state: nextState,
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, batch],
    },
    batch,
  };
}

export function redo(history: EditorHistory, state: EditorState): HistoryRedoResult | null {
  const batch = history.redoStack.at(-1);
  if (!batch) {
    return null;
  }

  return {
    state: applyBatchToState(state, batch),
    history: {
      undoStack: [...history.undoStack, batch],
      redoStack: history.redoStack.slice(0, -1),
    },
    batch,
  };
}
