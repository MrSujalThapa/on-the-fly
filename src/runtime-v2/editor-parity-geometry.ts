import type { IntendedRect } from "./placement-engine.js";

export type ResizeCorner = "nw" | "ne" | "sw" | "se";

export function resizeRectFromCorner(start: IntendedRect, corner: ResizeCorner, dx: number, dy: number, min = 8): IntendedRect {
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const x = corner.includes("w") ? Math.min(start.x + dx, right - min) : start.x;
  const y = corner.includes("n") ? Math.min(start.y + dy, bottom - min) : start.y;
  const nextRight = corner.includes("e") ? Math.max(start.x + min, right + dx) : right;
  const nextBottom = corner.includes("s") ? Math.max(start.y + min, bottom + dy) : bottom;
  return { x, y, width: nextRight - x, height: nextBottom - y };
}

export function scaleRects(startUnion: IntendedRect, targetUnion: IntendedRect, rects: readonly IntendedRect[]): IntendedRect[] {
  const sx = targetUnion.width / startUnion.width;
  const sy = targetUnion.height / startUnion.height;
  return rects.map((rect) => ({
    x: targetUnion.x + (rect.x - startUnion.x) * sx,
    y: targetUnion.y + (rect.y - startUnion.y) * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  }));
}

export function rotatePointAroundCenter(point: { x: number; y: number }, center: { x: number; y: number }, degrees: number): { x: number; y: number } {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

export function rotatedMemberRect(rect: IntendedRect, union: IntendedRect, degrees: number): IntendedRect {
  const center = { x: union.x + union.width / 2, y: union.y + union.height / 2 };
  const member = rotatePointAroundCenter({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, center, degrees);
  return { x: member.x - rect.width / 2, y: member.y - rect.height / 2, width: rect.width, height: rect.height };
}

export function localSizeForRotatedBounds(
  width: number,
  height: number,
  degrees: number,
  currentLocal: { width: number; height: number },
): { width: number; height: number } {
  const radians = degrees * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const determinant = cos * cos - sin * sin;
  if (Math.abs(determinant) > 0.08) {
    const localWidth = (width * cos - height * sin) / determinant;
    const localHeight = (height * cos - width * sin) / determinant;
    if (localWidth > 1 && localHeight > 1) return { width: localWidth, height: localHeight };
  }
  const currentBoundsWidth = cos * currentLocal.width + sin * currentLocal.height;
  const currentBoundsHeight = sin * currentLocal.width + cos * currentLocal.height;
  const scale = Math.min(width / Math.max(1, currentBoundsWidth), height / Math.max(1, currentBoundsHeight));
  return { width: Math.max(8, currentLocal.width * scale), height: Math.max(8, currentLocal.height * scale) };
}
