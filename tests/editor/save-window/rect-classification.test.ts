import { describe, expect, it } from "vitest";
import {
  classifyRectAgainstWindow,
  isPointInsideRect,
} from "../../../src/editor/save-window/rect-classification.js";

describe("save window rect classification", () => {
  const windowRect = { x: 100, y: 100, width: 200, height: 200 };

  it("keeps a target fully inside the window", () => {
    expect(
      classifyRectAgainstWindow({ x: 120, y: 120, width: 40, height: 40 }, windowRect),
    ).toBe("keep");
  });

  it("keeps a target whose center is inside the window", () => {
    expect(
      classifyRectAgainstWindow({ x: 260, y: 180, width: 80, height: 80 }, windowRect),
    ).toBe("keep");
  });

  it("reverts a target clearly outside the window", () => {
    expect(
      classifyRectAgainstWindow({ x: 20, y: 20, width: 40, height: 40 }, windowRect),
    ).toBe("revert");
  });

  it("marks partial overlap below threshold as ambiguous", () => {
    expect(
      classifyRectAgainstWindow({ x: 270, y: 180, width: 100, height: 80 }, windowRect),
    ).toBe("ambiguous");
  });

  it("detects points inside a rect", () => {
    expect(isPointInsideRect({ x: 150, y: 150 }, windowRect)).toBe(true);
    expect(isPointInsideRect({ x: 50, y: 50 }, windowRect)).toBe(false);
  });
});
