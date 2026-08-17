import { buildCssPath } from "../measurement/signature-builder.js";
import { extractBoundingBox } from "../measurement/bounding-box.js";
import type { MeasurementRect } from "../measurement/types.js";

export type InteractionPlacementMode = "viewport-fixed" | "containing-block-absolute";

const CONTAIN_PAINT = /(?:^|\s)paint(?:\s|$)/;

function hasNonNoneValue(value: string): boolean {
  return value.length > 0 && value !== "none" && value !== "normal";
}

function createsFixedContainingBlock(style: CSSStyleDeclaration): boolean {
  if (hasNonNoneValue(style.transform)) {
    return true;
  }
  if (hasNonNoneValue(style.filter)) {
    return true;
  }
  if (hasNonNoneValue(style.perspective)) {
    return true;
  }
  if (hasNonNoneValue(style.backdropFilter)) {
    return true;
  }
  if (style.containerType && style.containerType !== "normal") {
    return true;
  }
  if (CONTAIN_PAINT.test(style.contain)) {
    return true;
  }

  const willChange = style.willChange;
  return willChange.includes("transform") || willChange.includes("perspective") || willChange.includes("filter");
}

/** Nearest ancestor that traps `position: fixed` (common on SPA app shells). */
export function findFixedPositionContainingBlock(element: HTMLElement): HTMLElement | null {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return null;
  }

  let parent = element.parentElement;
  while (parent && parent !== element.ownerDocument.documentElement) {
    if (createsFixedContainingBlock(view.getComputedStyle(parent))) {
      return parent;
    }
    parent = parent.parentElement;
  }

  return null;
}

export function resolveInteractionPlacementMode(element: HTMLElement): InteractionPlacementMode {
  return findFixedPositionContainingBlock(element) ? "containing-block-absolute" : "viewport-fixed";
}

export function resolveInteractionAnchorCssPath(
  element: HTMLElement,
  anchor: HTMLElement | null,
): string | null {
  if (!anchor) {
    return null;
  }

  return buildCssPath(anchor, element.ownerDocument);
}

export interface InteractionPlacementCoords {
  mode: InteractionPlacementMode;
  position: "fixed" | "absolute";
  left: number;
  top: number;
  anchorCssPath: string | null;
}

/** Maps a viewport rect to inline left/top for interaction-safe placement. */
export function computeInteractionPlacementCoords(
  element: HTMLElement,
  rect: MeasurementRect,
): InteractionPlacementCoords {
  const anchor = findFixedPositionContainingBlock(element);
  const mode: InteractionPlacementMode = anchor ? "containing-block-absolute" : "viewport-fixed";
  const position = mode === "viewport-fixed" ? "fixed" : "absolute";
  const anchorCssPath = resolveInteractionAnchorCssPath(element, anchor);

  let left = rect.x;
  let top = rect.y;
  if (anchor) {
    const anchorRect = anchor.getBoundingClientRect();
    left = rect.x - anchorRect.left;
    top = rect.y - anchorRect.top;
  }

  return { mode, position, left, top, anchorCssPath };
}

export function viewportRectToInteractionPlacement(
  element: HTMLElement,
  rect: MeasurementRect,
): InteractionPlacementCoords {
  const placement = computeInteractionPlacementCoords(element, rect);
  element.style.position = placement.position;
  element.style.transform = "";
  element.style.left = `${String(placement.left)}px`;
  element.style.top = `${String(placement.top)}px`;

  const placed = extractBoundingBox(element);
  const errX = rect.x - placed.x;
  const errY = rect.y - placed.y;
  if (Math.abs(errX) > 0.5 || Math.abs(errY) > 0.5) {
    const left = placement.left + errX;
    const top = placement.top + errY;
    element.style.left = `${String(left)}px`;
    element.style.top = `${String(top)}px`;
    return { ...placement, left, top };
  }

  return placement;
}
