import type { VisualNodeRect } from "../visual-node.js";

export interface Point {
  x: number;
  y: number;
}

export function rectCenterPoint(rect: VisualNodeRect): Point {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

export function normalizeDegrees(degrees: number): number {
  let value = degrees % 360;
  if (value > 180) {
    value -= 360;
  }
  if (value <= -180) {
    value += 360;
  }
  return value;
}

/**
 * Returns the rotation (in degrees) for a pointer relative to a center, where a
 * pointer directly above the center reads as 0deg and clockwise is positive.
 */
export function angleForPointer(center: Point, pointer: Point): number {
  const radians = Math.atan2(pointer.y - center.y, pointer.x - center.x);
  return normalizeDegrees((radians * 180) / Math.PI + 90);
}

export function snapDegrees(degrees: number, increment: number): number {
  if (increment <= 0) {
    return normalizeDegrees(degrees);
  }
  return normalizeDegrees(Math.round(degrees / increment) * increment);
}
