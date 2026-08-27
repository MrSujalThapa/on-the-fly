import { readStoredTransformState, writeStoredTransformState, applyStoredTransformState, realizeIndependentBox } from "./element-snapshot.js";
import { MANAGED_Z_INDEX_BASELINE } from "../transform/layer-order.js";
import { OTF_INTERACTION_FIXED_ATTR, OTF_MANAGED_ATTR, OTF_TRANSFORM_ONLY_ATTR, type StoredTransformState } from "./types.js";
import type { MoveOperation } from "../operations.js";

export const OTF_DETACH_ATTR = "data-otf-detached";

export function originalSiblingLayer(element: HTMLElement): string {
  const siblings = element.parentElement ? Array.from(element.parentElement.children) : [];
  return String(1 + Math.max(0, siblings.indexOf(element)));
}

export function markTransformOnlyMove(element: HTMLElement): void {
  element.setAttribute(OTF_TRANSFORM_ONLY_ATTR, "true");
}

export function isTransformOnlyMove(element: HTMLElement): boolean {
  return (
    element.getAttribute(OTF_TRANSFORM_ONLY_ATTR) === "true" ||
    element.getAttribute(OTF_INTERACTION_FIXED_ATTR) === "true"
  );
}

const OUTSIDE_PARENT_TOLERANCE_PX = 2;
const INDEPENDENT_BASE_LAYER = String(MANAGED_Z_INDEX_BASELINE + 1);

export function realizeIndependentPlacement(
  element: HTMLElement,
  viewportRect: { x: number; y: number; width: number; height: number },
  options?: { zIndex?: string; preserveLocalSize?: boolean },
): void {
  const document = element.ownerDocument;
  if (element.parentElement !== document.body) {
    document.body.appendChild(element);
  }
  element.setAttribute(OTF_DETACH_ATTR, "true");
  element.setAttribute(OTF_MANAGED_ATTR, "true");
  element.removeAttribute(OTF_INTERACTION_FIXED_ATTR);
  element.removeAttribute(OTF_TRANSFORM_ONLY_ATTR);
  const rotate = readStoredTransformState(element)?.rotate ?? 0;
  const live = realizeIndependentBox(element, viewportRect, rotate, options?.preserveLocalSize
    ? { preserveLocalSize: true }
    : {});
  const nextState: StoredTransformState = {
    dx: 0,
    dy: 0,
    width: options?.preserveLocalSize ? viewportRect.width : live.width,
    height: options?.preserveLocalSize ? viewportRect.height : live.height,
    rotate,
    position: "absolute",
  };
  writeStoredTransformState(element, nextState);
  const layer = options?.zIndex ?? element.style.zIndex;
  element.style.zIndex = layer && layer !== "auto" ? layer : INDEPENDENT_BASE_LAYER;
}

export interface DetachPlacement {
  left: number;
  top: number;
  zIndex: string;
  width: string;
  height: string;
}

/** True when the element has an independent managed transform (moved/resized/rotated). */
export function hasIndependentManagedTransform(element: HTMLElement): boolean {
  if (!element.hasAttribute(OTF_MANAGED_ATTR)) {
    return false;
  }

  const state = readStoredTransformState(element);
  if (!state) {
    return false;
  }

  return (
    state.dx !== 0 ||
    state.dy !== 0 ||
    state.rotate !== 0 ||
    state.width !== null ||
    state.height !== null ||
    (state.position === "fixed" &&
      state.fixedLeft !== null &&
      state.fixedLeft !== undefined &&
      state.fixedTop !== null &&
      state.fixedTop !== undefined) ||
    (state.position === "absolute" &&
      state.fixedLeft !== null &&
      state.fixedLeft !== undefined &&
      state.fixedTop !== null &&
      state.fixedTop !== undefined)
  );
}

function isVisuallyOutsideParent(element: HTMLElement, parent: HTMLElement): boolean {
  const child = element.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  return (
    child.left < parentRect.left - OUTSIDE_PARENT_TOLERANCE_PX ||
    child.top < parentRect.top - OUTSIDE_PARENT_TOLERANCE_PX ||
    child.right > parentRect.right + OUTSIDE_PARENT_TOLERANCE_PX ||
    child.bottom > parentRect.bottom + OUTSIDE_PARENT_TOLERANCE_PX
  );
}

function findDetachContainerParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    if (
      parent === element.ownerDocument.body ||
      parent === element.ownerDocument.documentElement
    ) {
      return null;
    }

    const tag = parent.tagName.toLowerCase();
    if (tag === "main") {
      parent = parent.parentElement;
      continue;
    }

    return parent;
  }

  return null;
}

/**
 * When multiple elements move together in one batch, keep DOM hierarchy intact.
 * Otherwise detach when the element's visual box extends outside its container.
 */
export function shouldDetachAfterMove(
  element: HTMLElement,
  coMovedElements: readonly HTMLElement[],
): boolean {
  if (!hasIndependentManagedTransform(element)) {
    return false;
  }

  for (const other of coMovedElements) {
    if (other !== element && other.contains(element)) {
      return false;
    }
  }

  if (element.getAttribute(OTF_DETACH_ATTR) === "true") {
    return false;
  }

  const containerParent = findDetachContainerParent(element);
  if (!containerParent) {
    return false;
  }

  return isVisuallyOutsideParent(element, containerParent);
}

/**
 * Predict whether a move to `predicted` should detach, without requiring the
 * element to already have a managed transform (that is created by the move).
 */
export function shouldDetachForPredictedRect(
  element: HTMLElement,
  coMovedElements: readonly HTMLElement[],
  predicted: { x: number; y: number; width: number; height: number },
): boolean {
  for (const other of coMovedElements) {
    if (other !== element && other.contains(element)) {
      return false;
    }
  }

  if (element.getAttribute(OTF_DETACH_ATTR) === "true") {
    return false;
  }

  const containerParent = findDetachContainerParent(element);
  if (!containerParent) {
    return false;
  }

  const parentRect = containerParent.getBoundingClientRect();
  const overlapWidth = Math.max(
    0,
    Math.min(predicted.x + predicted.width, parentRect.right) -
      Math.max(predicted.x, parentRect.left),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(predicted.y + predicted.height, parentRect.bottom) -
      Math.max(predicted.y, parentRect.top),
  );
  const childArea = predicted.width * predicted.height;
  return childArea > 0 && (overlapWidth * overlapHeight) / childArea < 0.5;
}

/** Keep logically detached descendants fixed while an old DOM ancestor moves. */
export function counterMoveDetachedDescendants(
  root: HTMLElement,
  dx: number,
  dy: number,
): HTMLElement[] {
  const detached = Array.from(
    root.querySelectorAll<HTMLElement>(`[${OTF_DETACH_ATTR}="true"]`),
  );
  for (const element of detached) {
    const state = readStoredTransformState(element);
    if (!state) continue;
    const next = { ...state, dx: state.dx - dx, dy: state.dy - dy };
    writeStoredTransformState(element, next);
    applyStoredTransformState(element, next);
  }
  return detached;
}

export interface DetachRectOverride {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Reparents an element to `document.body` with absolute coordinates so ancestor
 * transforms no longer affect it. Returns placement metadata for persistence.
 *
 * When detaching several co-moved elements in one batch, pass `rectOverride`
 * with the element's intended (moved) viewport rect. Detaching the first
 * element pulls it out of flow and reflows its siblings, so re-measuring later
 * siblings with `getBoundingClientRect()` would capture the reflowed (wrong)
 * position. The override keeps placement deterministic regardless of order.
 */
export function promoteElementToManagedLayer(
  element: HTMLElement,
  rectOverride?: DetachRectOverride,
): DetachPlacement | null {
  const parent = element.parentElement;
  if (!parent || parent === element.ownerDocument.body) {
    return null;
  }

  const view = element.ownerDocument.defaultView;
  if (!view) {
    return null;
  }

  const measured = element.getBoundingClientRect();
  const rect = rectOverride
    ? { left: rectOverride.x, top: rectOverride.y, width: rectOverride.width, height: rectOverride.height }
    : measured;
  const scrollX = view.scrollX;
  const scrollY = view.scrollY;
  const placement: DetachPlacement = {
    left: rect.left + scrollX,
    top: rect.top + scrollY,
    zIndex: (() => {
      const current = element.style.zIndex || getComputedStyle(element).zIndex;
      return current && current !== "auto" ? current : INDEPENDENT_BASE_LAYER;
    })(),
    width: `${String(rect.width)}px`,
    height: `${String(rect.height)}px`,
  };

  element.ownerDocument.body.appendChild(element);
  element.setAttribute(OTF_DETACH_ATTR, "true");

  const existing = readStoredTransformState(element);
  const nextState: StoredTransformState = {
    dx: 0,
    dy: 0,
    width: rect.width,
    height: rect.height,
    rotate: existing?.rotate ?? 0,
    position: "absolute",
  };

  writeStoredTransformState(element, nextState);
  element.style.position = "absolute";
  element.style.left = `${String(placement.left)}px`;
  element.style.top = `${String(placement.top)}px`;
  element.style.width = placement.width;
  element.style.height = placement.height;
  element.style.boxSizing = "border-box";
  element.style.minWidth = "0";
  element.style.minHeight = "0";
  element.style.maxWidth = "none";
  element.style.maxHeight = "none";
  element.style.flexGrow = "0";
  element.style.flexShrink = "0";
  element.style.transform = `rotate(${String(nextState.rotate)}deg)`;
  element.style.zIndex = placement.zIndex;
  element.setAttribute(OTF_MANAGED_ATTR, "true");

  return placement;
}

export function tryDetachMovedElement(
  element: HTMLElement,
  coMovedElements: readonly HTMLElement[],
  rectOverride?: DetachRectOverride,
): DetachPlacement | null {
  if (!shouldDetachAfterMove(element, coMovedElements)) {
    return null;
  }
  return promoteElementToManagedLayer(element, rectOverride);
}

/** Applies a persisted detach placement from a saved move operation (replay). */
export function applyPersistedDetachPlacement(
  element: HTMLElement,
  operation: MoveOperation,
): void {
  if (!operation.payload.detached) {
    return;
  }

  const left = operation.payload.detachedLeft;
  const top = operation.payload.detachedTop;
  if (left === undefined || top === undefined) {
    return;
  }

  if (element.getAttribute(OTF_DETACH_ATTR) !== "true") {
    element.ownerDocument.body.appendChild(element);
    element.setAttribute(OTF_DETACH_ATTR, "true");
    element.setAttribute(OTF_MANAGED_ATTR, "true");
  }
  element.removeAttribute(OTF_INTERACTION_FIXED_ATTR);
  element.removeAttribute(OTF_TRANSFORM_ONLY_ATTR);

  const state = readStoredTransformState(element);
  if (state) {
    const nextState: StoredTransformState = { ...state, dx: 0, dy: 0, position: "absolute" };
    writeStoredTransformState(element, nextState);
    applyStoredTransformState(element, nextState);
    element.style.transform = `rotate(${String(nextState.rotate)}deg)`;
  }

  element.style.position = "absolute";
  element.style.left = `${String(left)}px`;
  element.style.top = `${String(top)}px`;
  const pixelWidth = operation.payload.detachedWidth ?? operation.metadata?.finalRect?.width;
  const pixelHeight = operation.payload.detachedHeight ?? operation.metadata?.finalRect?.height;
  if (pixelWidth && pixelWidth > 0) {
    element.style.width = `${String(pixelWidth)}px`;
  }
  if (pixelHeight && pixelHeight > 0) {
    element.style.height = `${String(pixelHeight)}px`;
  }
  element.style.boxSizing = "border-box";
  element.style.minWidth = "0";
  element.style.minHeight = "0";
  element.style.maxWidth = "none";
  element.style.maxHeight = "none";
  element.style.flexGrow = "0";
  element.style.flexShrink = "0";
  const intended = operation.metadata?.finalRect;
  if (intended) {
    const actual = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView;
    const intendedViewportX = left - (view?.scrollX ?? 0);
    const intendedViewportY = top - (view?.scrollY ?? 0);
    const correctedLeft = left + intendedViewportX - actual.x;
    const correctedTop = top + intendedViewportY - actual.y;
    element.style.left = `${String(correctedLeft)}px`;
    element.style.top = `${String(correctedTop)}px`;
  }
  const zIndex = operation.payload.detachedZIndex;
  element.style.zIndex = zIndex && zIndex !== "auto" ? zIndex : INDEPENDENT_BASE_LAYER;
}

/**
 * Descendants with independent transforms that are not part of the active drag
 * selection. Used to counter parent drag visually before detach commits.
 */
export function findCounterTransformDescendants(
  root: HTMLElement,
  excluded: ReadonlySet<HTMLElement>,
): HTMLElement[] {
  const results: HTMLElement[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

  let node = walker.nextNode();
  while (node) {
    if (node instanceof HTMLElement && node !== root && !excluded.has(node)) {
      if (hasIndependentManagedTransform(node) && node.getAttribute(OTF_DETACH_ATTR) !== "true") {
        results.push(node);
      }
    }
    node = walker.nextNode();
  }

  return results;
}
