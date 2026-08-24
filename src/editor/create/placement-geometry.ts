import { COMPONENT_DEFINITIONS } from "./component-definitions.js";
import type { CreatedElementKind, CreatedElementRect } from "./created-element.js";

const PLACE_THRESHOLD_PX = 4;

export function defaultCreatedRect(kind: CreatedElementKind, x: number, y: number): CreatedElementRect {
  const size = COMPONENT_DEFINITIONS[kind].defaultSize;
  return { x, y, width: size.width, height: size.height };
}

export function resolvePlacementRect(
  kind: CreatedElementKind,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): CreatedElementRect {
  const definition = COMPONENT_DEFINITIONS[kind];
  const rawWidth = Math.abs(endX - startX);
  const rawHeight = Math.abs(endY - startY);
  if (rawWidth < PLACE_THRESHOLD_PX && rawHeight < PLACE_THRESHOLD_PX) {
    return defaultCreatedRect(kind, startX, startY);
  }
  let width = Math.max(definition.minSize.width, rawWidth);
  let height = Math.max(definition.minSize.height, rawHeight);
  if (kind === "circle") {
    const size = Math.max(definition.minSize.width, Math.min(width, height));
    width = size;
    height = size;
  }
  if (kind === "divider") {
    height = Math.max(definition.minSize.height, Math.min(8, height || 2));
  }
  if (kind === "text" || kind === "heading") {
    height = Math.max(definition.minSize.height, Math.min(height, definition.defaultSize.height * 2));
  }
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width,
    height,
  };
}

export function unionRectWithPadding(
  rects: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  padding = 16,
): CreatedElementRect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return {
    x: left - padding,
    y: top - padding,
    width: Math.max(40, right - left + padding * 2),
    height: Math.max(40, bottom - top + padding * 2),
  };
}
