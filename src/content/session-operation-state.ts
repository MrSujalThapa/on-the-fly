import type { EditorOperation } from "../editor/operations.js";
import { appendOperations, removeOperationsById } from "./session-history.js";

/** Saved operations loaded from IndexedDB and replayed on page load. */
export interface SessionOperationState {
  savedOperations: EditorOperation[];
  /** Current-session edits not yet persisted. */
  draftOperations: EditorOperation[];
}

export function createSessionOperationState(
  savedOperations: EditorOperation[] = [],
): SessionOperationState {
  return {
    savedOperations: [...savedOperations],
    draftOperations: [],
  };
}

export function getAppliedOperations(state: SessionOperationState): EditorOperation[] {
  return [...state.savedOperations, ...state.draftOperations];
}

export function hasUnsavedChanges(state: SessionOperationState): boolean {
  return state.draftOperations.length > 0;
}

export function unsavedChangeCount(state: SessionOperationState): number {
  return state.draftOperations.length;
}

export function appendDraftOperations(
  state: SessionOperationState,
  operations: EditorOperation[],
): SessionOperationState {
  if (operations.length === 0) {
    return state;
  }

  const drafts = operations.map((operation) =>
    operation.status === "draft"
      ? operation
      : { ...operation, status: "draft" as const },
  );

  return {
    ...state,
    draftOperations: appendOperations(state.draftOperations, drafts),
  };
}

export function removeDraftOperationsById(
  state: SessionOperationState,
  ids: ReadonlySet<string>,
): SessionOperationState {
  return {
    ...state,
    draftOperations: removeOperationsById(state.draftOperations, ids),
  };
}

export function setDraftOperations(
  state: SessionOperationState,
  draftOperations: EditorOperation[],
): SessionOperationState {
  return {
    ...state,
    draftOperations: [...draftOperations],
  };
}

export function setSavedOperations(
  state: SessionOperationState,
  savedOperations: EditorOperation[],
): SessionOperationState {
  return {
    ...state,
    savedOperations: [...savedOperations],
  };
}

export function promoteAllDraftToSaved(state: SessionOperationState): SessionOperationState {
  const approved = state.draftOperations.map((operation) => ({
    ...operation,
    status: "approved" as const,
  }));

  return {
    savedOperations: appendOperations(state.savedOperations, approved),
    draftOperations: [],
  };
}

export function promoteDraftOperationsToSaved(
  state: SessionOperationState,
  keptDrafts: EditorOperation[],
): SessionOperationState {
  const keptIds = new Set(keptDrafts.map((operation) => operation.id));
  const approved = keptDrafts.map((operation) => ({
    ...operation,
    status: "approved" as const,
  }));

  return {
    savedOperations: appendOperations(state.savedOperations, approved),
    draftOperations: state.draftOperations.filter((operation) => !keptIds.has(operation.id)),
  };
}

export function clearDraftOperations(state: SessionOperationState): SessionOperationState {
  return {
    ...state,
    draftOperations: [],
  };
}

export function clearAllOperations(): SessionOperationState {
  return {
    savedOperations: [],
    draftOperations: [],
  };
}
