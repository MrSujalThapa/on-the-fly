import { describe, expect, it } from "vitest";
import { DomRuntimeAdapter } from "../../../src/editor/dom/dom-runtime-adapter.js";
import { readStoredTransformState } from "../../../src/editor/dom/element-snapshot.js";
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

    expect(element.style.transform).toContain("translate(10px, 5px)");
    expect(element.style.transform).toContain("rotate(30deg)");
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

  it("keeps a rotated element's later move in world-axis translation", () => {
    const { root } = createTestDocument(`<main><p class="target">Shape</p></main>`);
    const adapter = new DomRuntimeAdapter(root);
    const element = root.querySelector("p.target") as HTMLElement;
    const target = targetSignature("Shape");
    const rotate: RotateOperation = { ...createRotateOperation({ id: "rotate-first", payload: { degrees: 37 } }), target };
    const move: MoveOperation = { ...createMoveOperation({ id: "move-after", payload: { dx: 200, dy: 50 } }), target };

    expect(adapter.applyOperation(rotate).ok).toBe(true);
    expect(adapter.applyOperation(move).ok).toBe(true);
    expect(readStoredTransformState(element)).toMatchObject({ dx: 200, dy: 50, rotate: 37 });
    expect(element.style.transform).toBe("translate(200px, 50px) rotate(37deg)");
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
});
