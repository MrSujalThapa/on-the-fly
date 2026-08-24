import { describe, expect, it } from "vitest";
import { resizeRectFromCorner, rotatePointAroundCenter, rotatedMemberRect, scaleRects } from "../../src/runtime-v2/editor-parity-geometry.js";

describe("Runtime V2 resize/rotate geometry", () => {
  it.each([
    ["nw", -10, -20, { x: 0, y: 0, width: 110, height: 70 }],
    ["ne", 20, -10, { x: 10, y: 10, width: 120, height: 60 }],
    ["sw", -5, 30, { x: 5, y: 20, width: 105, height: 80 }],
    ["se", 25, 15, { x: 10, y: 20, width: 125, height: 65 }],
  ] as const)("anchors the opposite corner for %s", (corner, dx, dy, expected) => {
    expect(resizeRectFromCorner({ x: 10, y: 20, width: 100, height: 50 }, corner, dx, dy)).toEqual(expected);
  });

  it("scales disjoint member rects from pre-mutation geometry", () => {
    expect(scaleRects(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 10, y: 20, width: 200, height: 50 },
      [{ x: 0, y: 0, width: 20, height: 20 }, { x: 80, y: 80, width: 20, height: 20 }],
    )).toEqual([
      { x: 10, y: 20, width: 40, height: 10 },
      { x: 170, y: 60, width: 40, height: 10 },
    ]);
  });

  it("rotates points and member centers around the selection center", () => {
    const point = rotatePointAroundCenter({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(10);
    expect(rotatedMemberRect(
      { x: 0, y: 0, width: 20, height: 10 },
      { x: 0, y: 0, width: 100, height: 100 },
      180,
    )).toEqual({ x: 80, y: 90, width: 20, height: 10 });
  });
});
