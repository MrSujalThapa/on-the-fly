import type { MoveOperation, ResizeOperation, RotateOperation } from "../../operations.js";
import { extractBoundingBox } from "../../measurement/bounding-box.js";
import {
  applyStoredTransformState,
  readStoredTransformState,
  type ElementSnapshotStore,
  writeStoredTransformState,
} from "../element-snapshot.js";
import { applyPersistedDetachPlacement, OTF_DETACH_ATTR } from "../managed-detach.js";
import {
  applyPersistedInteractionSafeFixed,
  applyInteractionSafeFixedDelta,
  isInteractionSafeFixed,
  isLegacyTransformOnlyMovePayload,
  shouldApplyInteractionSafeFixed,
} from "../interactive-fixed-placement.js";
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
): AppliedDomEffect["changes"] {
  if (operation.metadata?.finalRect) {
    return applyMoveToFinalRect(element, operation, snapshotStore);
  }

  if (isInteractionSafeFixed(element)) {
    return applyInteractionSafeFixedDelta(
      element,
      operation.payload.dx,
      operation.payload.dy,
      snapshotStore,
    );
  }

  const { state, previousSerialized } = ensureTransformState(element, snapshotStore);
  state.dx += operation.payload.dx;
  state.dy += operation.payload.dy;

  const changes = commitTransformState(element, state, previousSerialized);

  if (operation.payload.detached && !operation.payload.interactionSafeFixed && !isLegacyTransformOnlyMovePayload(operation)) {
    applyPersistedDetachPlacement(element, operation);
  }

  return changes;
}

function applyMoveToFinalRect(
  element: HTMLElement,
  operation: MoveOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  snapshotStore.captureIfNeeded(element);
  const finalRect = operation.metadata?.finalRect;
  if (!finalRect) {
    return [];
  }

  if (shouldApplyInteractionSafeFixed(operation)) {
    return applyPersistedInteractionSafeFixed(element, operation, snapshotStore);
  }

  if (operation.payload.detached && !operation.payload.interactionSafeFixed && !isLegacyTransformOnlyMovePayload(operation)) {
    applyPersistedDetachPlacement(element, operation);

    // `detachedLeft/detachedTop` are page coordinates (viewport + scroll at save
    // time), so they reproduce the saved position regardless of the scroll
    // offset when replay runs. Only fall back to the viewport `finalRect` plus
    // the current scroll for legacy ops that predate page-coordinate placement.
    const hasPersistedPlacement =
      operation.payload.detachedLeft !== undefined &&
      operation.payload.detachedTop !== undefined;
    if (!hasPersistedPlacement) {
      const view = element.ownerDocument.defaultView;
      element.style.position = "absolute";
      element.style.left = `${String(finalRect.x + (view?.scrollX ?? 0))}px`;
      element.style.top = `${String(finalRect.y + (view?.scrollY ?? 0))}px`;
    }

    const { state, previousSerialized } = ensureTransformState(element, snapshotStore);
    state.dx = 0;
    state.dy = 0;
    state.position = "absolute";
    // Carry the saved size in the transform state so `commitTransformState`
    // applies it. Setting width/height directly would be wiped by the trailing
    // `applyStoredTransformState`, which removes them when state.width is null.
    if (finalRect.width > 0) {
      state.width = finalRect.width;
    }
    if (finalRect.height > 0) {
      state.height = finalRect.height;
    }
    return commitTransformState(element, state, previousSerialized);
  }

  const current = extractBoundingBox(element);
  const dx = finalRect.x - current.x;
  const dy = finalRect.y - current.y;
  const { state, previousSerialized } = ensureTransformState(element, snapshotStore);
  state.dx += dx;
  state.dy += dy;
  const changes = commitTransformState(element, state, previousSerialized);
  if (operation.payload.detached) {
    element.setAttribute(OTF_DETACH_ATTR, "true");
  }
  return changes;
}

export function applyResizeOperation(
  element: HTMLElement,
  operation: ResizeOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  snapshotStore.captureIfNeeded(element);
  const previousWidth = element.style.width;
  const previousHeight = element.style.height;
  const previousBoxSizing = element.style.boxSizing;

  if (operation.payload.mode === "font-aware") {
    element.style.fontSize = `${String(operation.payload.height)}px`;

    return [{ kind: "size", previousWidth, previousHeight, previousBoxSizing }];
  }

  if (operation.metadata?.finalRect) {
    const finalRect = operation.metadata.finalRect;
    element.style.boxSizing = "border-box";
    const { state, previousSerialized } = ensureTransformState(element, snapshotStore);
    state.width = finalRect.width;
    state.height = finalRect.height;

    const current = extractBoundingBox(element);
    state.dx = finalRect.x - current.x;
    state.dy = finalRect.y - current.y;

    return [
      ...commitTransformState(element, state, previousSerialized),
      { kind: "size", previousWidth, previousHeight, previousBoxSizing },
    ];
  }

  // Computed/selection rects are border-box. Pin box-sizing so the inline
  // width/height we apply match the visible box on block/card/container
  // elements that carry padding or borders (common for white card wrappers).
  element.style.boxSizing = "border-box";

  const { state, previousSerialized } = ensureTransformState(element, snapshotStore);
  state.width = operation.payload.width;
  state.height = operation.payload.height;

  return [
    ...commitTransformState(element, state, previousSerialized),
    { kind: "size", previousWidth, previousHeight, previousBoxSizing },
  ];
}

export function applyRotateOperation(
  element: HTMLElement,
  operation: RotateOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  const { state, previousSerialized } = ensureTransformState(element, snapshotStore);
  state.rotate = operation.payload.degrees;

  return commitTransformState(element, state, previousSerialized);
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

  if (change.previousBoxSizing) {
    element.style.boxSizing = change.previousBoxSizing;
  } else {
    element.style.removeProperty("box-sizing");
  }

  element.style.removeProperty("font-size");
}
