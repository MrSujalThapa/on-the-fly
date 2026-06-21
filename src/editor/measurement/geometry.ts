import type { AlignmentEdge, MeasurementRect } from "./types.js";
import { DEFAULT_ALIGNMENT_TOLERANCE_PX } from "./constants.js";

export function rectArea(rect: MeasurementRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

export function rectsOverlap(a: MeasurementRect, b: MeasurementRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function overlapArea(a: MeasurementRect, b: MeasurementRect): number {
  if (!rectsOverlap(a, b)) {
    return 0;
  }

  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

export function rectCenter(rect: MeasurementRect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export function rectDistance(a: MeasurementRect, b: MeasurementRect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  return Math.hypot(dx, dy);
}

export function containsRect(outer: MeasurementRect, inner: MeasurementRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function edgeValue(rect: MeasurementRect, edge: AlignmentEdge): number {
  switch (edge) {
    case "left":
      return rect.x;
    case "right":
      return rect.x + rect.width;
    case "top":
      return rect.y;
    case "bottom":
      return rect.y + rect.height;
    case "centerX":
      return rect.x + rect.width / 2;
    case "centerY":
      return rect.y + rect.height / 2;
  }
}

export function areEdgesAligned(
  a: MeasurementRect,
  b: MeasurementRect,
  edge: AlignmentEdge,
  tolerance: number = DEFAULT_ALIGNMENT_TOLERANCE_PX,
): boolean {
  return Math.abs(edgeValue(a, edge) - edgeValue(b, edge)) <= tolerance;
}
