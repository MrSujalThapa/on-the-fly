import type { EditorOperation, ZIndexOperation } from "../editor/operations.js";
import {
  filterSupersededZIndexOperations,
  keepLatestZIndexOperationsByTarget,
} from "../editor/persistence/coalesce-page-operations.js";
import { appendOperations, removeOperationsById } from "./session-history.js";

/** Saved operations loaded from IndexedDB and replayed on page load. */
export interface SessionOperationState {
  savedOperations: EditorOperation[];
  /** Current-session edits not yet persisted. */
  draftOperations: EditorOperation[];
  /** Unsaved preview edits, separate from drafts until explicit approval. */
  previewOperations: EditorOperation[];
}

export function createSessionOperationState(
  savedOperations: EditorOperation[] = [],
): SessionOperationState {
  return {
    savedOperations: [...savedOperations],
    draftOperations: [],
    previewOperations: [],
  };
}

export function getAppliedOperations(state: SessionOperationState): EditorOperation[] {
  return [...state.savedOperations, ...state.draftOperations, ...state.previewOperations];
}

export function hasUnsavedChanges(state: SessionOperationState): boolean {
  return state.draftOperations.length > 0;
}

export function unsavedChangeCount(state: SessionOperationState): number {
  return state.draftOperations.length;
}

function normalizeDraftOperations(incoming: EditorOperation[]): EditorOperation[] {
  const drafts = incoming.map((operation) =>
    operation.status === "draft"
      ? operation
      : { ...operation, status: "draft" as const },
  );

  return keepLatestZIndexOperationsByTarget(drafts);
}

export function appendDraftOperations(
  state: SessionOperationState,
  operations: EditorOperation[],
): SessionOperationState {
  if (operations.length === 0) {
    return state;
  }

  const normalizedIncoming = normalizeDraftOperations(operations);
  const incomingZIndex = normalizedIncoming.filter(
    (operation): operation is ZIndexOperation => operation.type === "zIndex",
  );
  const savedWithoutSupersededZIndex = filterSupersededZIndexOperations(
    state.draftOperations,
    incomingZIndex,
  );

  return {
    ...state,
    draftOperations: appendOperations(savedWithoutSupersededZIndex, normalizedIncoming),
  };
}

export function appendPreviewOperations(
  state: SessionOperationState,
  operations: EditorOperation[],
): SessionOperationState {
  if (operations.length === 0) {
    return state;
  }

  const previews = operations.map((operation) =>
    operation.status === "preview"
      ? operation
      : { ...operation, status: "preview" as const },
  );

  return {
    ...state,
    previewOperations: appendOperations(state.previewOperations, previews),
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

export function clearPreviewOperations(state: SessionOperationState): SessionOperationState {
  return {
    ...state,
    previewOperations: [],
  };
}

export function promotePreviewOperationsToDraft(
  state: SessionOperationState,
  previewOperations: EditorOperation[] = state.previewOperations,
): SessionOperationState {
  if (previewOperations.length === 0) {
    return state;
  }

  const previewIds = new Set(previewOperations.map((operation) => operation.id));
  const drafts = previewOperations.map((operation) => ({
    ...operation,
    status: "draft" as const,
  }));

  return {
    ...state,
    draftOperations: appendOperations(state.draftOperations, drafts),
    previewOperations: state.previewOperations.filter((operation) => !previewIds.has(operation.id)),
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

function promoteDraftsToSavedOperations(
  savedOperations: EditorOperation[],
  draftOperations: EditorOperation[],
): EditorOperation[] {
  const approved = draftOperations.map((operation) => ({
    ...operation,
    status: "approved" as const,
  })) as EditorOperation[];
  const incomingZIndex = approved.filter(
    (operation): operation is ZIndexOperation => operation.type === "zIndex",
  );
  const savedWithoutSupersededZIndex = filterSupersededZIndexOperations(
    savedOperations,
    incomingZIndex,
  );
  const merged = appendOperations(savedWithoutSupersededZIndex, approved);
  return keepLatestZIndexOperationsByTarget(merged);
}

export function promoteAllDraftToSaved(state: SessionOperationState): SessionOperationState {
  return {
    savedOperations: promoteDraftsToSavedOperations(
      state.savedOperations,
      state.draftOperations,
    ),
    draftOperations: [],
    previewOperations: state.previewOperations,
  };
}

export function promoteDraftOperationsToSaved(
  state: SessionOperationState,
  keptDrafts: EditorOperation[],
): SessionOperationState {
  const keptIds = new Set(keptDrafts.map((operation) => operation.id));

  return {
    savedOperations: promoteDraftsToSavedOperations(state.savedOperations, keptDrafts),
    draftOperations: state.draftOperations.filter((operation) => !keptIds.has(operation.id)),
    previewOperations: state.previewOperations,
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
    previewOperations: [],
  };
}
