import {
  cloneEditorState,
  createInitialEditorState,
  type EditorState,
  type GroupState,
} from "../editor-state.js";
import type { GroupId } from "../ids.js";
import type { EditorOperation, OperationStatus } from "../operations.js";
import { assertValidOperation } from "../validation/validate-operation.js";

export class OperationApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationApplyError";
  }
}

function listKeyForStatus(
  status: OperationStatus,
): "approvedOperations" | "draftOperations" | "previewOperations" {
  switch (status) {
    case "approved":
      return "approvedOperations";
    case "draft":
      return "draftOperations";
    case "preview":
      return "previewOperations";
  }
}

function removeGroup(state: EditorState, groupId: GroupId): void {
  state.groups = Object.fromEntries(
    Object.entries(state.groups).filter(([id]) => id !== groupId),
  );
}

function applyGroupSideEffects(state: EditorState, operation: EditorOperation): void {
  if (operation.type === "group") {
    const groupState: GroupState = {
      groupId: operation.payload.groupId,
      memberNodeIds: [...operation.payload.memberNodeIds],
      memberSignatures: [...operation.payload.memberSignatures],
    };
    state.groups[operation.payload.groupId] = groupState;
    return;
  }

  if (operation.type === "ungroup") {
    removeGroup(state, operation.payload.groupId);
  }
}

function revertGroupSideEffects(state: EditorState, operation: EditorOperation): void {
  if (operation.type === "group") {
    removeGroup(state, operation.payload.groupId);
    return;
  }

  if (operation.type === "ungroup") {
    // Ungroup revert requires prior group metadata; no-op if unknown at this layer.
  }
}

function removeOperationFromList(state: EditorState, operation: EditorOperation): boolean {
  const listKey = listKeyForStatus(operation.status);
  const index = state[listKey].findIndex((entry) => entry.id === operation.id);
  if (index === -1) {
    return false;
  }

  state[listKey].splice(index, 1);
  return true;
}

export function applyOperation(state: EditorState, operation: EditorOperation): EditorState {
  assertValidOperation(operation);

  if (operation.pageKey !== state.pageKey) {
    throw new OperationApplyError("operation.pageKey does not match editor state pageKey");
  }

  const next = cloneEditorState(state);
  const listKey = listKeyForStatus(operation.status);

  if (next[listKey].some((entry) => entry.id === operation.id)) {
    throw new OperationApplyError(`operation already applied: ${operation.id}`);
  }

  next[listKey].push(operation);
  applyGroupSideEffects(next, operation);
  next.version += 1;
  return next;
}

export function revertOperation(state: EditorState, operation: EditorOperation): EditorState {
  assertValidOperation(operation);

  const next = cloneEditorState(state);
  const removed = removeOperationFromList(next, operation);
  if (!removed) {
    throw new OperationApplyError(`operation not found in state: ${operation.id}`);
  }

  revertGroupSideEffects(next, operation);
  next.version += 1;
  return next;
}

export function replayOperations(
  pageKey: string,
  operations: EditorOperation[],
  initialState?: EditorState,
): EditorState {
  const base = initialState ?? createInitialEditorState(pageKey);
  return operations.reduce((state, operation) => applyOperation(state, operation), base);
}

export function clearDraftAndPreview(state: EditorState): EditorState {
  const next = cloneEditorState(state);
  next.draftOperations = [];
  next.previewOperations = [];
  next.version += 1;
  return next;
}

export function approveDraftOperations(state: EditorState): EditorState {
  const next = cloneEditorState(state);
  const drafts = [...next.draftOperations];

  for (const draft of drafts) {
    const approved = { ...draft, status: "approved" as const };
    next.draftOperations = next.draftOperations.filter((entry) => entry.id !== draft.id);
    next.approvedOperations.push(approved);
    applyGroupSideEffects(next, approved);
  }

  next.version += 1;
  return next;
}

export function getApprovedOperations(state: EditorState): readonly EditorOperation[] {
  return state.approvedOperations;
}

export function getGroupState(state: EditorState, groupId: GroupId): GroupState | undefined {
  return state.groups[groupId];
}
