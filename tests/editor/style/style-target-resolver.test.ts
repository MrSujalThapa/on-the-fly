import { describe, expect, it } from "vitest";
import { clampOpacity, parseOpacityInput } from "../../../src/editor/style/opacity-value.js";
import { resolveStyleElementTargets } from "../../../src/editor/style/style-target-resolver.js";
import { createTestDocument } from "../dom/test-document.js";
import type { TransformTarget } from "../../../src/editor/transform/transform-target.js";

describe("opacity-value", () => {
  it("clamps and rejects empty opacity input", () => {
    expect(parseOpacityInput("")).toBeNull();
    expect(parseOpacityInput("2")).toBe(1);
    expect(parseOpacityInput("0.5")).toBe(0.5);
    expect(clampOpacity(-1)).toBe(0);
  });
});

describe("style-target-resolver", () => {
  it("applies text color to descendants inside a container", () => {
    const { document, root } = createTestDocument(`
      <main>
        <div id="card">
          <span id="title">Notification</span>
          <span id="body">Details</span>
        </div>
      </main>
    `);
    const card = root.querySelector("#card") as HTMLElement;
    const target: TransformTarget = {
      nodeId: "group-1",
      signature: {
        cssPath: "main div#card",
        tagName: "div",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 0, y: 0, width: 100, height: 40 },
      element: card,
    };

    const resolution = resolveStyleElementTargets("color", [target], document);
    expect(resolution.targets.length).toBe(2);
  });

  it("applies text color to descendants for each group member", () => {
    const { document, root } = createTestDocument(`
      <main>
        <div id="card-a"><span id="title-a">A</span></div>
        <div id="card-b"><span id="title-b">B</span></div>
      </main>
    `);
    const cardA = root.querySelector("#card-a") as HTMLElement;
    const cardB = root.querySelector("#card-b") as HTMLElement;
    const targetA: TransformTarget = {
      nodeId: "group-a",
      signature: {
        cssPath: "main div#card-a",
        tagName: "div",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 0, y: 0, width: 100, height: 20 },
      element: cardA,
    };
    const targetB: TransformTarget = {
      nodeId: "group-b",
      signature: {
        cssPath: "main div#card-b",
        tagName: "div",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 0, y: 0, width: 100, height: 20 },
      element: cardB,
    };

    const resolution = resolveStyleElementTargets("color", [targetA, targetB], document);
    expect(resolution.targets.length).toBe(2);
  });
});
