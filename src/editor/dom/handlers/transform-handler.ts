import type { MoveOperation, ResizeOperation, RotateOperation } from "../../operations.js";
import {
  applyStoredTransformState,
  readStoredTransformState,
  type ElementSnapshotStore,
  writeStoredTransformState,
} from "../element-snapshot.js";
import { OTF_TRANSFORM_ATTR, type AppliedDomEffect, type StoredTransformState } from "../types.js";

function createInitialTransformState(
  element: HTMLElement,
  snapshotStore: ElementSnapshotStore,
): StoredTransformState {
  const snapshot = snapshotStore.captureIfNeeded(element);
  const position = snapshot.position === "static" ? "relative" : snapshot.position;

  return {
    dx: 0,
    dy: 0,
    width: null,
    height: null,
    rotate: 0,
    position,
  };
}

function ensureTransformState(
  element: HTMLElement,
  snapshotStore: ElementSnapshotStore,
): { state: StoredTransformState; previousSerialized: string | null } {
  const previousSerialized = element.getAttribute(OTF_TRANSFORM_ATTR);
  const existing = readStoredTransformState(element);
  const state = existing ?? createInitialTransformState(element, snapshotStore);

  if (!existing && state.position === "relative") {
    element.style.position = "relative";
  }

  return { state, previousSerialized };
}

function commitTransformState(
  element: HTMLElement,
  state: StoredTransformState,
  previousSerialized: string | null,
): AppliedDomEffect["changes"] {
  writeStoredTransformState(element, state);
  applyStoredTransformState(element, state);

  return [{ kind: "transform-state", previousState: previousSerialized }];
}

export function applyMoveOperation(
  element: HTMLElement,
  operation: MoveOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect {
  const { state, previousSerialized } = ensureTransformState(element, snapshotStore);
  state.dx += operation.payload.dx;
  state.dy += operation.payload.dy;

  return {
    operationId: operation.id,
    changes: commitTransformState(element, state, previousSerialized),
  };
}

export function applyResizeOperation(
  element: HTMLElement,
  operation: ResizeOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect {
  snapshotStore.captureIfNeeded(element);
  const previousWidth = element.style.width;
  const previousHeight = element.style.height;

  if (operation.payload.mode === "font-aware") {
    element.style.fontSize = `${String(operation.payload.height)}px`;

    return {
      operationId: operation.id,
      changes: [{ kind: "size", previousWidth, previousHeight }],
    };
  }

  const { state, previousSerialized } = ensureTransformState(element, snapshotStore);
  state.width = operation.payload.width;
  state.height = operation.payload.height;

  return {
    operationId: operation.id,
    changes: [
      ...commitTransformState(element, state, previousSerialized),
      { kind: "size", previousWidth, previousHeight },
    ],
  };
}

export function applyRotateOperation(
  element: HTMLElement,
  operation: RotateOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect {
  const { state, previousSerialized } = ensureTransformState(element, snapshotStore);
  state.rotate = operation.payload.degrees;

  return {
    operationId: operation.id,
    changes: commitTransformState(element, state, previousSerialized),
  };
}

export function revertTransformStateChange(
  element: HTMLElement,
  change: Extract<AppliedDomEffect["changes"][number], { kind: "transform-state" }>,
): void {
  if (change.previousState) {
    element.setAttribute(OTF_TRANSFORM_ATTR, change.previousState);
    const restored = readStoredTransformState(element);
    if (restored) {
      applyStoredTransformState(element, restored);
      return;
    }
  }

  writeStoredTransformState(element, null);
  element.style.removeProperty("transform");
  element.style.removeProperty("position");
}

export function revertSizeChange(
  element: HTMLElement,
  change: Extract<AppliedDomEffect["changes"][number], { kind: "size" }>,
): void {
  if (change.previousWidth) {
    element.style.width = change.previousWidth;
  } else {
    element.style.removeProperty("width");
  }

  if (change.previousHeight) {
    element.style.height = change.previousHeight;
  } else {
    element.style.removeProperty("height");
  }

  element.style.removeProperty("font-size");
}
