import type { EditorOperation } from "../editor/operations.js";

export interface SessionHistory {
  undoStack: EditorOperation[][];
  redoStack: EditorOperation[][];
}

export function createSessionHistory(): SessionHistory {
  return { undoStack: [], redoStack: [] };
}

export function recordHistoryBatch(
  history: SessionHistory,
  operations: EditorOperation[],
): SessionHistory {
  if (operations.length === 0) {
    return history;
  }

  return {
    undoStack: [...history.undoStack, operations],
    redoStack: [],
  };
}

export function canUndo(history: SessionHistory): boolean {
  return history.undoStack.length > 0;
}

export function canRedo(history: SessionHistory): boolean {
  return history.redoStack.length > 0;
}

export function popUndoBatch(history: SessionHistory): {
  history: SessionHistory;
  batch: EditorOperation[] | null;
} {
  const batch = history.undoStack.at(-1) ?? null;
  if (!batch) {
    return { history, batch: null };
  }

  return {
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, batch],
    },
    batch,
  };
}

export function popRedoBatch(history: SessionHistory): {
  history: SessionHistory;
  batch: EditorOperation[] | null;
} {
  const batch = history.redoStack.at(-1) ?? null;
  if (!batch) {
    return { history, batch: null };
  }

  return {
    history: {
      undoStack: [...history.undoStack, batch],
      redoStack: history.redoStack.slice(0, -1),
    },
    batch,
  };
}

export function removeOperationsById(
  operations: EditorOperation[],
  ids: ReadonlySet<string>,
): EditorOperation[] {
  return operations.filter((operation) => !ids.has(operation.id));
}

export function appendOperations(
  existing: EditorOperation[],
  incoming: EditorOperation[],
): EditorOperation[] {
  if (incoming.length === 0) {
    return existing;
  }
  return [...existing, ...incoming];
}
