import { containsRect, overlapArea, rectArea, rectCenter } from "../measurement/geometry.js";
import type { MeasurementRect } from "../measurement/types.js";
import { SAVE_WINDOW_INTERSECTION_THRESHOLD } from "./constants.js";

export type SaveWindowRectDisposition = "keep" | "revert" | "ambiguous";

export function isPointInsideRect(
  point: { x: number; y: number },
  rect: MeasurementRect,
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function classifyRectAgainstWindow(
  targetRect: MeasurementRect,
  windowRect: MeasurementRect,
  threshold: number = SAVE_WINDOW_INTERSECTION_THRESHOLD,
): SaveWindowRectDisposition {
  if (targetRect.width <= 0 || targetRect.height <= 0) {
    return "ambiguous";
  }

  if (containsRect(windowRect, targetRect)) {
    return "keep";
  }

  const center = rectCenter(targetRect);
  if (isPointInsideRect(center, windowRect)) {
    return "keep";
  }

  const intersection = overlapArea(targetRect, windowRect);
  const targetArea = rectArea(targetRect);
  if (targetArea <= 0) {
    return "ambiguous";
  }

  const ratio = intersection / targetArea;
  if (ratio >= threshold) {
    return "keep";
  }

  if (intersection <= 0) {
    return "revert";
  }

  return "ambiguous";
}
