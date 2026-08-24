import { describe, expect, it } from "vitest";
import {
  computeResize,
  MIN_RESIZE_SIZE_PX,
} from "../../../src/editor/transform/resize-geometry.js";
import {
  angleForPointer,
  normalizeDegrees,
  rectCenterPoint,
  snapDegrees,
} from "../../../src/editor/transform/rotate-geometry.js";
import {
  BACK_LAYER,
  computeNextLayer,
  FRONT_LAYER,
  parseLayer,
} from "../../../src/editor/transform/layer-order.js";

const RECT = { x: 100, y: 100, width: 200, height: 100 };

describe("resize geometry", () => {
  it("grows from the south-east corner without moving the anchor", () => {
    const result = computeResize(RECT, "se", 40, 20);
    expect(result).toEqual({ width: 240, height: 120, dx: 0, dy: 0 });
  });

  it("shrinks from the north-west corner and shifts the origin", () => {
    const result = computeResize(RECT, "nw", 30, 10);
    expect(result.width).toBe(170);
    expect(result.height).toBe(90);
    expect(result.dx).toBe(30);
    expect(result.dy).toBe(10);
  });

  it("clamps to the minimum size", () => {
    const result = computeResize(RECT, "e", -1000, 0);
    expect(result.width).toBe(MIN_RESIZE_SIZE_PX);
  });

  it("only changes one dimension for an edge handle", () => {
    const result = computeResize(RECT, "s", 0, 25);
    expect(result.width).toBe(RECT.width);
    expect(result.height).toBe(125);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
  });
});

describe("rotate geometry", () => {
  it("reads 0deg when the pointer is directly above the center", () => {
    const center = rectCenterPoint(RECT);
    expect(angleForPointer(center, { x: center.x, y: center.y - 50 })).toBeCloseTo(0);
  });

  it("reads 90deg to the right and -90deg to the left", () => {
    const center = rectCenterPoint(RECT);
    expect(angleForPointer(center, { x: center.x + 50, y: center.y })).toBeCloseTo(90);
    expect(angleForPointer(center, { x: center.x - 50, y: center.y })).toBeCloseTo(-90);
  });

  it("normalizes and snaps degrees", () => {
    expect(normalizeDegrees(450)).toBe(90);
    expect(snapDegrees(43, 15)).toBe(45);
  });
});

describe("layer order", () => {
  it("steps forward and backward", () => {
    expect(computeNextLayer(3, "forward")).toBe(4);
    expect(computeNextLayer(3, "forward", 10)).toBe(11);
    expect(computeNextLayer(3, "backward")).toBe(2);
  });

  it("jumps to front and back", () => {
    expect(computeNextLayer(3, "front")).toBe(FRONT_LAYER);
    expect(computeNextLayer(3, "back")).toBe(BACK_LAYER);
    expect(computeNextLayer(3, "back", 0, 1)).toBe(1);
  });

  it("does not step below the back layer", () => {
    expect(computeNextLayer(BACK_LAYER, "backward")).toBe(BACK_LAYER);
  });

  it("parses layer values with a numeric fallback", () => {
    expect(parseLayer("7")).toBe(7);
    expect(parseLayer("auto")).toBe(0);
    expect(parseLayer(undefined)).toBe(0);
  });
});
