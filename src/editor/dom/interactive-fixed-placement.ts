import {
  readStoredTransformState,
  type ElementSnapshotStore,
  writeStoredTransformState,
} from "./element-snapshot.js";
import {
  viewportRectToInteractionPlacement,
  type InteractionPlacementCoords,
} from "./fixed-position-anchor.js";
import {
  OTF_INTERACTION_FIXED_ATTR,
  OTF_MANAGED_ATTR,
  OTF_TRANSFORM_ONLY_ATTR,
  type AppliedDomEffect,
  type StoredTransformState,
} from "./types.js";
import type { MoveOperation } from "../operations.js";

export { OTF_INTERACTION_FIXED_ATTR };

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isInteractionSafeFixed(element: HTMLElement): boolean {
  return element.getAttribute(OTF_INTERACTION_FIXED_ATTR) === "true";
}

function isLegacyTransformOnlyPayload(operation: MoveOperation): boolean {
  // Legacy persisted moves predate the explicit interactionSafeFixed flag.
  // Current Runtime V2 operations always write interactionSafeFixed as a
  // boolean, so transformOnly=true on a current operation must not be mistaken
  // for a legacy payload. Misclassifying it suppresses real detach placement.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- replay migration for saved ops
  return operation.payload.transformOnly === true && operation.payload.interactionSafeFixed === undefined;
}

export function isLegacyTransformOnlyMovePayload(operation: MoveOperation): boolean {
  return isLegacyTransformOnlyPayload(operation);
}

export function shouldApplyInteractionSafeFixed(operation: MoveOperation): boolean {
  if (operation.payload.interactionSafeFixed) {
    return true;
  }

  if (operation.payload.interactionSafeFixed === false) {
    return false;
  }

  if (isLegacyTransformOnlyPayload(operation) && operation.metadata?.finalRect) {
    return true;
  }

  return (
    operation.payload.fixedViewportLeft !== undefined &&
    operation.payload.fixedViewportTop !== undefined
  );
}

export function resolveInteractionSafeFixedRect(operation: MoveOperation): ViewportRect {
  const finalRect = operation.metadata?.finalRect;
  return {
    x: operation.payload.fixedViewportLeft ?? finalRect?.x ?? 0,
    y: operation.payload.fixedViewportTop ?? finalRect?.y ?? 0,
    width: operation.payload.fixedWidth ?? finalRect?.width ?? 0,
    height: operation.payload.fixedHeight ?? finalRect?.height ?? 0,
  };
}

function buildFixedTransformState(
  element: HTMLElement,
  rect: ViewportRect,
  placement: InteractionPlacementCoords,
): StoredTransformState {
  const existing = readStoredTransformState(element);
  return {
    dx: 0,
    dy: 0,
    width: rect.width > 0 ? rect.width : null,
    height: rect.height > 0 ? rect.height : null,
    rotate: existing?.rotate ?? 0,
    position: placement.position,
    fixedLeft: placement.left,
    fixedTop: placement.top,
    placementMode: placement.mode,
    anchorCssPath: placement.anchorCssPath,
  };
}

export function applyInteractionSafeFixedStyles(
  element: HTMLElement,
  state: StoredTransformState,
): void {
  element.style.position = state.position;
  if (state.fixedLeft !== null && state.fixedLeft !== undefined) {
    element.style.left = `${String(state.fixedLeft)}px`;
  }
  if (state.fixedTop !== null && state.fixedTop !== undefined) {
    element.style.top = `${String(state.fixedTop)}px`;
  }

  if (state.rotate !== 0) {
    element.style.transform = `rotate(${String(state.rotate)}deg)`;
  } else {
    element.style.transform = "";
  }

  if (state.width !== null) {
    element.style.width = `${String(state.width)}px`;
  } else {
    element.style.removeProperty("width");
  }

  if (state.height !== null) {
    element.style.height = `${String(state.height)}px`;
  } else {
    element.style.removeProperty("height");
  }
}

function applyPersistedPlacementCoords(
  element: HTMLElement,
  operation: MoveOperation,
  rect: ViewportRect,
): InteractionPlacementCoords {
  const left = operation.payload.interactionPlacementLeft;
  const top = operation.payload.interactionPlacementTop;
  const mode = operation.payload.interactionPlacementMode;
  if (left !== undefined && top !== undefined && mode) {
    const position = mode === "viewport-fixed" ? "fixed" : "absolute";
    element.style.position = position;
    element.style.left = `${String(left)}px`;
    element.style.top = `${String(top)}px`;
    element.style.transform = "";
    return {
      mode,
      position,
      left,
      top,
      anchorCssPath: operation.payload.interactionAnchorCssPath ?? null,
    };
  }

  return viewportRectToInteractionPlacement(element, rect);
}

/** Applies fixed viewport placement on the original DOM node (no reparent). */
export function applyInteractionSafeFixedPlacement(
  element: HTMLElement,
  rect: ViewportRect,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  const previousSerialized = element.getAttribute("data-otf-transform");
  snapshotStore.captureIfNeeded(element);
  element.setAttribute(OTF_INTERACTION_FIXED_ATTR, "true");
  element.setAttribute(OTF_MANAGED_ATTR, "true");
  element.removeAttribute(OTF_TRANSFORM_ONLY_ATTR);

  const placement = viewportRectToInteractionPlacement(element, rect);
  const state = buildFixedTransformState(element, rect, placement);
  writeStoredTransformState(element, state);
  applyInteractionSafeFixedStyles(element, state);

  return [{ kind: "transform-state", previousState: previousSerialized }];
}

export function applyInteractionSafeFixedDelta(
  element: HTMLElement,
  dx: number,
  dy: number,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  const current = element.getBoundingClientRect();
  return applyInteractionSafeFixedPlacement(
    element,
    {
      x: current.x + dx,
      y: current.y + dy,
      width: current.width,
      height: current.height,
    },
    snapshotStore,
  );
}

export function applyPersistedInteractionSafeFixed(
  element: HTMLElement,
  operation: MoveOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  const previousSerialized = element.getAttribute("data-otf-transform");
  snapshotStore.captureIfNeeded(element);
  element.setAttribute(OTF_INTERACTION_FIXED_ATTR, "true");
  element.setAttribute(OTF_MANAGED_ATTR, "true");
  element.removeAttribute(OTF_TRANSFORM_ONLY_ATTR);

  const rect = resolveInteractionSafeFixedRect(operation);
  const placement = applyPersistedPlacementCoords(element, operation, rect);
  const state = buildFixedTransformState(element, rect, placement);
  writeStoredTransformState(element, state);
  applyInteractionSafeFixedStyles(element, state);

  return [{ kind: "transform-state", previousState: previousSerialized }];
}

export function buildInteractionSafeFixedPayload(
  operation: MoveOperation,
  rect: ViewportRect,
  element: HTMLElement,
): MoveOperation["payload"] {
  const stored = readStoredTransformState(element);
  const payload: MoveOperation["payload"] = {
    ...operation.payload,
    interactionSafeFixed: true,
    transformOnly: false,
    detached: false,
    fixedViewportLeft: rect.x,
    fixedViewportTop: rect.y,
    fixedWidth: rect.width,
    fixedHeight: rect.height,
    interactionAnchorCssPath: stored?.anchorCssPath ?? null,
  };
  if (stored?.placementMode) {
    payload.interactionPlacementMode = stored.placementMode;
  }
  if (stored?.fixedLeft !== null && stored?.fixedLeft !== undefined) {
    payload.interactionPlacementLeft = stored.fixedLeft;
  }
  if (stored?.fixedTop !== null && stored?.fixedTop !== undefined) {
    payload.interactionPlacementTop = stored.fixedTop;
  }
  return payload;
}
