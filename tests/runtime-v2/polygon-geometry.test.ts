import { describe, expect, it } from "vitest";
import {
  clipPolygonToRect,
  isMeaningfulFreeform,
  pointInPolygon,
  polygonArea,
  polygonQualifiesRect,
  polygonRectIntersectionArea,
  simplifyPolygon,
} from "../../src/runtime-v2/polygon-geometry.js";
import { MEANINGFUL_OVERLAP_RATIO, meaningfullyIntersects } from "../../src/runtime-v2/lasso-selection.js";

const square = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
];
const reverse = [...square].reverse();
const concave = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 }, { x: 6, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 },
];
const bowtie = [
  { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 },
];

describe("polygon geometry", () => {
  it.each([
    [{ x: 5, y: 5 }, square, true],
    [{ x: 15, y: 5 }, square, false],
    [{ x: 5, y: 5 }, reverse, true],
    [{ x: 5, y: 7 }, concave, false],
    [{ x: 2, y: 8 }, concave, true],
    [{ x: 2, y: 8 }, bowtie, false],
    [{ x: 8, y: 2 }, bowtie, true],
    [{ x: 5, y: 1 }, bowtie, false],
  ] as const)("point-in-polygon %#", (point, polygon, expected) => {
    expect(pointInPolygon(point, polygon)).toBe(expected);
  });

  it("treats clockwise and counter-clockwise area as equivalent", () => {
    expect(polygonArea(square)).toBe(polygonArea(reverse));
  });

  it("qualifies by center-inside and rejects tiny-edge overlap", () => {
    expect(polygonQualifiesRect(square, { x: 4, y: 4, width: 2, height: 2 })).toBe(true);
    expect(polygonQualifiesRect(square, { x: 9.5, y: 9.5, width: 20, height: 20 })).toBe(false);
    expect(polygonRectIntersectionArea(square, { x: 9.5, y: 9.5, width: 20, height: 20 })).toBeLessThan(1);
  });

  it("clips a polygon to a rect and preserves a meaningful outline under simplification", () => {
    const clipped = clipPolygonToRect(square, { x: 2, y: 2, width: 4, height: 4 });
    expect(polygonArea(clipped)).toBeCloseTo(16);
    const noisy = Array.from({ length: 40 }, (_, index) => ({ x: index, y: index * 0.02 }));
    expect(simplifyPolygon(noisy, 1.75).length).toBeLessThan(noisy.length);
    expect(isMeaningfulFreeform(square)).toBe(true);
    expect(isMeaningfulFreeform(square.slice(0, 2))).toBe(false);
  });

  it("keeps the rectangle lasso overlap threshold unchanged", () => {
    expect(MEANINGFUL_OVERLAP_RATIO).toBe(0.5);
    expect(meaningfullyIntersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 10, height: 10 })).toBe(false);
    expect(meaningfullyIntersects({ x: 0, y: 0, width: 4, height: 4 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(true);
  });
});
