import { describe, expect, it } from "vitest";
import {
  areEdgesAligned,
  containsRect,
  overlapArea,
  rectArea,
  rectDistance,
  rectsOverlap,
} from "../../../src/editor/measurement/geometry.js";

describe("geometry helpers", () => {
  it("computes area, overlap, distance, containment, and alignment", () => {
    const a = { x: 0, y: 0, width: 100, height: 50 };
    const b = { x: 80, y: 20, width: 40, height: 40 };
    const c = { x: 200, y: 0, width: 20, height: 20 };

    expect(rectArea(a)).toBe(5000);
    expect(rectsOverlap(a, b)).toBe(true);
    expect(rectsOverlap(a, c)).toBe(false);
    expect(overlapArea(a, b)).toBe(600);
    expect(containsRect(a, { x: 10, y: 10, width: 20, height: 10 })).toBe(true);
    expect(rectDistance(a, c)).toBe(100);
    expect(areEdgesAligned(a, b, "top", 25)).toBe(true);
    expect(areEdgesAligned(a, c, "left")).toBe(false);
  });
});
