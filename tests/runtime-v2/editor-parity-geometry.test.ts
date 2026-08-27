import { describe, expect, it } from "vitest";
import { aabbFromLocalSize, planMultiResizeMembers, resizeLocalFromScreenDelta, resizeRectFromCorner, rotatePointAroundCenter, rotatedMemberRect, scaleRects } from "../../src/runtime-v2/editor-parity-geometry.js";

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

  it("plans multi-resize from group AABB so each member owns Ri'", () => {
    const start = { x: 0, y: 0, width: 100, height: 40 };
    const target = { x: 0, y: 0, width: 200, height: 80 };
    const planned = planMultiResizeMembers(start, target, [
      { rect: { x: 0, y: 0, width: 40, height: 40 }, local: { width: 40, height: 40 }, rotate: 0 },
      { rect: { x: 60, y: 0, width: 40, height: 40 }, local: { width: 40, height: 40 }, rotate: 0 },
    ]);
    expect(planned[0]).toEqual({ aabb: { x: 0, y: 0, width: 80, height: 80 }, local: { width: 80, height: 80 } });
    expect(planned[1]).toEqual({ aabb: { x: 120, y: 0, width: 80, height: 80 }, local: { width: 80, height: 80 } });
    const union = {
      x: Math.min(planned[0]!.aabb.x, planned[1]!.aabb.x),
      y: Math.min(planned[0]!.aabb.y, planned[1]!.aabb.y),
      width: 200,
      height: 80,
    };
    expect(union).toEqual(target);
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

  it("keeps persistent size in local axes and derives world AABB from local+θ", () => {
    const local = { width: 200, height: 50 };
    const unrotatedBox = { x: 10, y: 20, width: 200, height: 50 };
    const se0 = resizeLocalFromScreenDelta(local, unrotatedBox, 0, "se", 20, 10);
    expect(se0.local).toEqual({ width: 220, height: 60 });
    expect(se0.aabb).toEqual(resizeRectFromCorner(unrotatedBox, "se", 20, 10));

    const rotated30 = aabbFromLocalSize({ x: 0, y: 0 }, local, 30);
    expect(rotated30.width).toBeCloseTo(local.width * Math.abs(Math.cos(Math.PI / 6)) + local.height * Math.abs(Math.sin(Math.PI / 6)));
    const se30 = resizeLocalFromScreenDelta(local, rotated30, 30, "se", 20, 0);
    expect(se30.local.width).not.toBeCloseTo(se30.aabb.width);
    expect(se30.local.width).toBeGreaterThan(local.width);
    const derived = aabbFromLocalSize({ x: se30.aabb.x, y: se30.aabb.y }, se30.local, 30);
    expect(derived.width).toBeCloseTo(se30.aabb.width);
    expect(derived.height).toBeCloseTo(se30.aabb.height);
  });
});
