import type { IntendedRect } from "./placement-engine.js";
import { MOVE_GEOMETRY_TOLERANCE_PX } from "./operation-executor.js";

export function rectFromElement(element: HTMLElement): IntendedRect {
  const box = element.getBoundingClientRect();
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
}

export function rectsNear(
  actual: IntendedRect,
  expected: IntendedRect,
  tolerance = MOVE_GEOMETRY_TOLERANCE_PX,
): boolean {
  return (
    Math.abs(actual.x - expected.x) <= tolerance &&
    Math.abs(actual.y - expected.y) <= tolerance &&
    Math.abs(actual.width - expected.width) <= tolerance &&
    Math.abs(actual.height - expected.height) <= tolerance
  );
}
