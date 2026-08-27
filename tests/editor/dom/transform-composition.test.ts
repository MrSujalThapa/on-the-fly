import { describe, expect, it } from "vitest";
import { DomRuntimeAdapter } from "../../../src/editor/dom/dom-runtime-adapter.js";
import { composeManagedTransform, readLocalLayoutSize, readStoredTransformState } from "../../../src/editor/dom/element-snapshot.js";
import { INDEPENDENT_LAYER, realizeIndependentPlacement } from "../../../src/editor/dom/managed-detach.js";
import type { MoveOperation, ResizeOperation, RotateOperation } from "../../../src/editor/operations.js";
import { createMoveOperation, createResizeOperation, createRotateOperation, PAGE_KEY } from "../fixtures.js";
import { createTestDocument } from "./test-document.js";

function targetSignature(text: string) {
  return {
    nodeId: "node-transform",
    signature: {
      cssPath: "main p.target",
      tagName: "p",
      classList: ["target"],
      textFingerprint: text,
      boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
    },
  };
}

describe("transform composition", () => {
  it("keeps translation on viewport axes when composed with rotation", () => {
    expect(composeManagedTransform(200, 0, 45)).toBe("translate(200px, 0px) rotate(45deg)");
    expect(composeManagedTransform(0, 0, 90)).toBe("rotate(90deg)");
    expect(composeManagedTransform(10, 5, 0)).toBe("translate(10px, 5px)");
  });
  it("accumulates move operations and restores on sequential reverts", () => {
    const { root } = createTestDocument(`<main><p class="target">Block</p></main>`);
    const adapter = new DomRuntimeAdapter(root);
    const element = root.querySelector("p.target");
    const target = targetSignature("Block");

    const moveA: MoveOperation = {
      ...createMoveOperation({ id: "move-a", payload: { dx: 10, dy: 5 } }),
      target,
    };
    const moveB: MoveOperation = {
      ...createMoveOperation({ id: "move-b", payload: { dx: 4, dy: -2 } }),
      target,
    };

    expect(adapter.applyOperation(moveA).ok).toBe(true);
    expect(adapter.applyOperation(moveB).ok).toBe(true);
    expect(element instanceof HTMLElement && element.style.transform).toContain("translate(14px, 3px)");

    expect(adapter.revertOperation(moveB).ok).toBe(true);
    expect(element instanceof HTMLElement && element.style.transform).toContain("translate(10px, 5px)");

    expect(adapter.revertOperation(moveA).ok).toBe(true);
    expect(element instanceof HTMLElement && element.style.transform).toBe("");
  });

  it("composes move, resize, and rotate in stored transform state", () => {
    const { root } = createTestDocument(`<main><p class="target">Shape</p></main>`);
    const adapter = new DomRuntimeAdapter(root);
    const element = root.querySelector("p.target") as HTMLElement;
    const target = targetSignature("Shape");

    const move: MoveOperation = { ...createMoveOperation({ id: "move" }), target };
    const resize: ResizeOperation = {
      ...createResizeOperation({ id: "resize", payload: { width: 140, height: 90, mode: "box" } }),
      target,
    };
    const rotate: RotateOperation = {
      ...createRotateOperation({ id: "rotate", payload: { degrees: 30 } }),
      target,
    };

    expect(adapter.applyOperation(move).ok).toBe(true);
    expect(adapter.applyOperation(resize).ok).toBe(true);
    expect(adapter.applyOperation(rotate).ok).toBe(true);

    expect(element.style.transform).toBe("translate(10px, 5px) rotate(30deg)");
    expect(element.getAttribute("data-otf-detached")).toBeNull();
    expect(element.style.width).toBe("140px");
    expect(element.style.height).toBe("90px");

    const stored = readStoredTransformState(element);
    expect(stored?.dx).toBe(10);
    expect(stored?.dy).toBe(5);
    expect(stored?.rotate).toBe(30);
    expect(stored?.width).toBe(140);
    expect(stored?.height).toBe(90);

    expect(adapter.revertOperation(rotate).ok).toBe(true);
    expect(adapter.revertOperation(resize).ok).toBe(true);
    expect(adapter.revertOperation(move).ok).toBe(true);
    expect(element.style.transform).toBe("");
  });

  it("keeps rotate independent when the target is already detached", () => {
    const { root } = createTestDocument(`<main><p class="target">Shape</p></main>`);
    const adapter = new DomRuntimeAdapter(root);
    const element = root.querySelector("p.target") as HTMLElement;
    realizeIndependentPlacement(element, { x: 40, y: 30, width: 140, height: 90 });
    const rotate: RotateOperation = {
      ...createRotateOperation({ id: "rotate", payload: { degrees: 30 } }),
      target: targetSignature("Shape"),
    };
    expect(adapter.applyOperation(rotate).ok).toBe(true);
    expect(element.getAttribute("data-otf-detached")).toBe("true");
    expect(element.parentElement).toBe(root);
    expect(readStoredTransformState(element)?.rotate).toBe(30);
  });

  it("rejects unsupported DOM operations with typed errors", () => {
    const { root } = createTestDocument(`<main><p class="target">Block</p></main>`);
    const adapter = new DomRuntimeAdapter(root);

    // `ungroup` is a valid editor operation but cannot be applied to the DOM.
    const result = adapter.applyOperation({
      id: "ungroup-1",
      type: "ungroup",
      pageKey: PAGE_KEY,
      target: targetSignature("Block"),
      payload: { groupId: "group-1" },
      createdAt: 1,
      source: "manual",
      status: "approved",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported_dom_operation");
    }
  });

  it("independent placement stacks above site chrome instead of sibling index", () => {
    const { root } = createTestDocument(
      `<section><div role="radiogroup"><button class="target">Mentions</button></div></section>`,
    );
    const element = root.querySelector("button.target") as HTMLElement;
    realizeIndependentPlacement(element, { x: 40, y: 30, width: 80, height: 32 });
    expect(element.parentElement).toBe(root);
    expect(element.style.zIndex).toBe(String(INDEPENDENT_LAYER));
    expect(Number.parseInt(element.style.zIndex, 10)).toBeGreaterThan(100);
  });

  it("keeps independent local size after the live style is clobbered", () => {
    const { root } = createTestDocument(`<button class="target">Mentions</button>`);
    const element = root.querySelector("button.target") as HTMLElement;
    realizeIndependentPlacement(element, { x: 40, y: 30, width: 128, height: 54 });
    element.removeAttribute("data-otf-transform");
    element.style.width = "92px";
    element.style.height = "32px";
    expect(readLocalLayoutSize(element)).toEqual({ width: 128, height: 54 });
  });
});
