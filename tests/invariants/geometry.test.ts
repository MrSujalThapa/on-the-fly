import { describe, expect, it } from "vitest";
import { composeManagedTransform } from "../../src/editor/dom/element-snapshot.js";
import {
  aabbFromLocalSize,
  planMultiResizeMembers,
  resizeLocalFromScreenDelta,
  resizeRectFromCorner,
  rotatePointAroundCenter,
  rotatedMemberRect,
} from "../../src/runtime-v2/editor-parity-geometry.js";
import { dropCoveredAncestors, MEANINGFUL_OVERLAP_RATIO, meaningfullyIntersects } from "../../src/runtime-v2/lasso-selection.js";
import {
  clipPolygonToRect,
  isMeaningfulFreeform,
  pointInPolygon,
  polygonArea,
  polygonQualifiesRect,
  simplifyPolygon,
} from "../../src/runtime-v2/polygon-geometry.js";
import { discoverFromElement, discoverFromPath } from "../../src/runtime-v2/visual-hierarchy.js";
import { createTestDocument } from "../editor/dom/test-document.js";

const square = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
];

function stubRect(element: HTMLElement, rect: { x: number; y: number; width: number; height: number }): void {
  element.getBoundingClientRect = () => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON() {
      return this;
    },
  });
}

describe("pure geometry", () => {
  it("classifies points against convex, reverse, concave, and self-intersecting polygons", () => {
    const reverse = [...square].reverse();
    const concave = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 }, { x: 6, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 },
    ];
    const bowtie = [
      { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 },
    ];
    const cases: Array<[{ x: number; y: number }, typeof square, boolean]> = [
      [{ x: 5, y: 5 }, square, true],
      [{ x: 15, y: 5 }, square, false],
      [{ x: 5, y: 5 }, reverse, true],
      [{ x: 5, y: 7 }, concave, false],
      [{ x: 2, y: 8 }, concave, true],
      [{ x: 2, y: 8 }, bowtie, false],
      [{ x: 8, y: 2 }, bowtie, true],
    ];
    for (const [point, polygon, expected] of cases) {
      expect(pointInPolygon(point, polygon), JSON.stringify(point)).toBe(expected);
    }
    expect(polygonArea(square)).toBe(polygonArea(reverse));
  });

  it("qualifies lasso hits by centre coverage and keeps the overlap threshold", () => {
    expect(polygonQualifiesRect(square, { x: 4, y: 4, width: 2, height: 2 })).toBe(true);
    expect(polygonQualifiesRect(square, { x: 9.5, y: 9.5, width: 20, height: 20 })).toBe(false);
    expect(clipPolygonToRect(square, { x: 2, y: 2, width: 4, height: 4 }).length).toBeGreaterThan(0);
    expect(simplifyPolygon(Array.from({ length: 40 }, (_, index) => ({ x: index, y: index * 0.02 })), 1.75).length).toBeLessThan(40);
    expect(isMeaningfulFreeform(square)).toBe(true);
    expect(MEANINGFUL_OVERLAP_RATIO).toBe(0.5);
    expect(meaningfullyIntersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 10, height: 10 })).toBe(false);
  });

  it("drops covering ancestors from a lasso hit set and keeps independent siblings", () => {
    const parent = document.createElement("div");
    const first = document.createElement("button");
    const second = document.createElement("button");
    parent.append(first, second);
    expect(dropCoveredAncestors([
      { id: "parent", element: parent },
      { id: "first", element: first },
      { id: "second", element: second },
    ])).toEqual(["first", "second"]);
    expect(dropCoveredAncestors([
      { id: "first", element: first },
      { id: "second", element: document.createElement("button") },
    ])).toEqual(["first", "second"]);
  });

  it("keeps translation on viewport axes when composed with rotation", () => {
    expect(composeManagedTransform(200, 0, 45)).toBe("translate(200px, 0px) rotate(45deg)");
    expect(composeManagedTransform(0, 0, 90)).toBe("rotate(90deg)");
    expect(composeManagedTransform(10, 5, 0)).toBe("translate(10px, 5px)");
  });

  it("anchors the opposite corner and keeps persistent size in local axes", () => {
    const start = { x: 10, y: 20, width: 100, height: 50 };
    expect(resizeRectFromCorner(start, "se", 25, 15)).toEqual({ x: 10, y: 20, width: 125, height: 65 });
    expect(resizeRectFromCorner(start, "nw", -10, -20)).toEqual({ x: 0, y: 0, width: 110, height: 70 });
    const local = { width: 200, height: 50 };
    const rotated = aabbFromLocalSize({ x: 0, y: 0 }, local, 30);
    expect(rotated.width).toBeCloseTo(local.width * Math.abs(Math.cos(Math.PI / 6)) + local.height * Math.abs(Math.sin(Math.PI / 6)));
    const se30 = resizeLocalFromScreenDelta(local, rotated, 30, "se", 20, 0);
    expect(se30.local.width).not.toBeCloseTo(se30.aabb.width);
    const derived = aabbFromLocalSize({ x: se30.aabb.x, y: se30.aabb.y }, se30.local, 30);
    expect(derived.width).toBeCloseTo(se30.aabb.width);
    const point = rotatePointAroundCenter({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(10);
    expect(rotatedMemberRect({ x: 0, y: 0, width: 20, height: 10 }, { x: 0, y: 0, width: 100, height: 100 }, 180))
      .toEqual({ x: 80, y: 90, width: 20, height: 10 });
  });

  it("plans multi-resize from the group AABB so each member owns its own local size", () => {
    const planned = planMultiResizeMembers(
      { x: 0, y: 0, width: 100, height: 40 },
      { x: 0, y: 0, width: 200, height: 80 },
      [
        { rect: { x: 0, y: 0, width: 40, height: 40 }, local: { width: 40, height: 40 }, rotate: 0 },
        { rect: { x: 60, y: 0, width: 40, height: 40 }, local: { width: 40, height: 40 }, rotate: 0 },
      ],
    );
    expect(planned[0]).toEqual({ aabb: { x: 0, y: 0, width: 80, height: 80 }, local: { width: 80, height: 80 } });
    expect(planned[1]).toEqual({ aabb: { x: 120, y: 0, width: 80, height: 80 }, local: { width: 80, height: 80 } });
  });

  it("promotes an overflowing text fragment to its interactive control", () => {
    const { root } = createTestDocument(`<a href="#mentions"><span>Mentions</span></a>`);
    const control = root.querySelector("a") as HTMLElement;
    const fragment = root.querySelector("span") as HTMLElement;
    stubRect(control, { x: 593, y: 104, width: 92, height: 28 });
    stubRect(fragment, { x: 605, y: 98, width: 68, height: 40 });
    const discovered = discoverFromElement(fragment);
    expect(discovered?.binding).toBe(control);
  });

  it("never selects a boxless display:contents wrapper", () => {
    const { root } = createTestDocument(
      `<div style="display:contents"><a href="#profile"><span>Jordan</span></a></div>`,
    );
    const wrapper = root.querySelector("div") as HTMLElement;
    const control = root.querySelector("a") as HTMLElement;
    wrapper.style.display = "contents";
    stubRect(wrapper, { x: 0, y: 0, width: 0, height: 0 });
    stubRect(control, { x: 40, y: 40, width: 200, height: 80 });
    stubRect(root.querySelector("span") as HTMLElement, { x: 48, y: 48, width: 80, height: 20 });
    const discovered = discoverFromPath([wrapper, control]);
    expect(discovered?.binding).toBe(control);
    expect(discovered?.binding).not.toBe(wrapper);
  });
});
