import type { VisualNodeRect } from "../visual-node.js";
import type { MeasurementRect } from "./types.js";

export function extractBoundingBox(element: Element): MeasurementRect {
  const rect = element.getBoundingClientRect();
  return normalizeRect(rect);
}

export function normalizeRect(rect: DOMRect | VisualNodeRect): MeasurementRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

export function isZeroSizeRect(rect: MeasurementRect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

export function rectToVisualNodeRect(rect: MeasurementRect): VisualNodeRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}
