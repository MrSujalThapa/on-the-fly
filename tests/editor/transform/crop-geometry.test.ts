import { describe, expect, it } from "vitest";
import {
  applyCropToRect,
  computeCrop,
  createEmptyCropInsets,
  cropInsetsToClipPath,
  isCropped,
} from "../../../src/editor/transform/crop-geometry.js";

const RECT = { x: 100, y: 50, width: 300, height: 200 };

describe("crop geometry", () => {
  it("grows the right inset when dragging the east handle inward", () => {
    const insets = computeCrop(RECT, "e", createEmptyCropInsets(), -40, 0);
    expect(insets).toEqual({ top: 0, right: 40, bottom: 0, left: 0 });
  });

  it("grows the left inset when dragging the west handle inward", () => {
    const insets = computeCrop(RECT, "w", createEmptyCropInsets(), 30, 0);
    expect(insets).toEqual({ top: 0, right: 0, bottom: 0, left: 30 });
  });

  it("crops two edges from a corner handle", () => {
    const insets = computeCrop(RECT, "se", createEmptyCropInsets(), -50, -20);
    expect(insets).toEqual({ top: 0, right: 50, bottom: 20, left: 0 });
  });

  it("never produces negative insets", () => {
    const insets = computeCrop(RECT, "e", createEmptyCropInsets(), 80, 0);
    expect(insets.right).toBe(0);
  });

  it("keeps a minimum visible region when over-cropping", () => {
    const insets = computeCrop(RECT, "e", { top: 0, right: 290, bottom: 0, left: 0 }, -100, 0);
    // width 300, min visible 8 → max horizontal inset total 292.
    expect(insets.right).toBeLessThanOrEqual(292);
    expect(RECT.width - insets.left - insets.right).toBeGreaterThanOrEqual(8);
  });

  it("accumulates from a base inset", () => {
    const insets = computeCrop(RECT, "e", { top: 0, right: 10, bottom: 0, left: 0 }, -20, 0);
    expect(insets.right).toBe(30);
  });

  it("computes the visible rect after cropping", () => {
    const visible = applyCropToRect(RECT, { top: 10, right: 20, bottom: 30, left: 40 });
    expect(visible).toEqual({ x: 140, y: 60, width: 240, height: 160 });
  });

  it("serializes insets to a clip-path inset() value", () => {
    expect(cropInsetsToClipPath({ top: 1, right: 2, bottom: 3, left: 4 })).toBe(
      "inset(1px 2px 3px 4px)",
    );
  });

  it("reports whether any edge is cropped", () => {
    expect(isCropped(createEmptyCropInsets())).toBe(false);
    expect(isCropped({ top: 0, right: 5, bottom: 0, left: 0 })).toBe(true);
  });
});
