import type { EditorOperation } from "../editor/operations.js";
import type { OperationBatchSnapshot } from "../editor/dom/operation-batch-snapshot.js";
import { createEmptyBatchSnapshot } from "../editor/dom/operation-batch-snapshot.js";

export interface HistoryBatch {
  operations: EditorOperation[];
  snapshot: OperationBatchSnapshot;
}

export interface SessionHistory {
  undoStack: HistoryBatch[];
  redoStack: HistoryBatch[];
}

export function createSessionHistory(): SessionHistory {
  return { undoStack: [], redoStack: [] };
}

export function recordHistoryBatch(
  history: SessionHistory,
  operations: EditorOperation[],
  snapshot: OperationBatchSnapshot = createEmptyBatchSnapshot(),
): SessionHistory {
  if (operations.length === 0) {
    return history;
  }

  return {
    undoStack: [...history.undoStack, { operations, snapshot }],
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
  batch: HistoryBatch | null;
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
  batch: HistoryBatch | null;
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

/** Drops history batches that only contained reverted operation ids. */
export function pruneSessionHistory(
  history: SessionHistory,
  removedIds: ReadonlySet<string>,
): SessionHistory {
  if (removedIds.size === 0) {
    return history;
  }

  const filterBatch = (batch: HistoryBatch): HistoryBatch | null => {
    const operations = batch.operations.filter((operation) => !removedIds.has(operation.id));
    if (operations.length === 0) {
      return null;
    }

    const keptIds = new Set(operations.map((operation) => operation.id));
    const elements = batch.snapshot.elements
      .map((entry) => ({
        ...entry,
        operationIds: entry.operationIds.filter((id) => keptIds.has(id)),
      }))
      .filter((entry) => entry.operationIds.length > 0);

    return {
      operations,
      snapshot: { elements },
    };
  };

  const undoStack = history.undoStack
    .map(filterBatch)
    .filter((batch): batch is HistoryBatch => batch !== null);
  const redoStack = history.redoStack
    .map(filterBatch)
    .filter((batch): batch is HistoryBatch => batch !== null);

  return { undoStack, redoStack };
}
