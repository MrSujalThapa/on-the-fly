import { describe, expect, it } from "vitest";
import {
  buildCropOperation,
  buildHideOperation,
  buildMoveOperation,
  buildMoveOperations,
  buildResizeOperation,
  buildRotateOperation,
  buildZIndexOperation,
} from "../../../src/editor/transform/operation-factory.js";
import type { TransformTarget } from "../../../src/editor/transform/transform-target.js";
import { validateOperationForDom } from "../../../src/editor/validation/validate-dom-operation.js";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import { buildPersistableElementSignature } from "../../../src/editor/measurement/signature-builder.js";
import { createTestDocument } from "../dom/test-document.js";

const PAGE_KEY = "https://example.com/";

function makeTarget(nodeId: string, text: string): TransformTarget {
  return {
    nodeId,
    signature: {
      cssPath: `main .${nodeId}`,
      tagName: "div",
      classList: [nodeId],
      textFingerprint: text,
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
    rect: { x: 0, y: 0, width: 100, height: 40 },
  };
}

let idCounter = 0;
function deterministicId(): string {
  idCounter += 1;
  return `op-${String(idCounter)}`;
}

const baseOptions = { pageKey: PAGE_KEY, now: 1_700_000_000_000, createId: deterministicId };

describe("transform operation factory", () => {
  it("builds a single move operation that passes DOM validation", () => {
    const target = makeTarget("alpha", "Alpha");
    const op = buildMoveOperation(target, 24, -8, baseOptions);

    expect(op.type).toBe("move");
    expect(op.payload).toEqual({ dx: 24, dy: -8 });
    expect(op.target.signature).toBe(target.signature);
    expect(op.source).toBe("manual");
    expect(op.status).toBe("draft");
    expect(validateOperationForDom(op).ok).toBe(true);
  });

  it("builds a move operation for every group member (group move)", () => {
    const targets = [makeTarget("a", "A"), makeTarget("b", "B"), makeTarget("c", "C")];
    const ops = buildMoveOperations(targets, 10, 12, baseOptions);

    expect(ops).toHaveLength(3);
    for (const [index, op] of ops.entries()) {
      expect(op.type).toBe("move");
      expect(op.payload).toEqual({ dx: 10, dy: 12 });
      expect(op.target.nodeId).toBe(targets[index]?.nodeId);
      expect(validateOperationForDom(op).ok).toBe(true);
    }
    const ids = new Set(ops.map((op) => op.id));
    expect(ids.size).toBe(3);
  });

  it("builds a resize operation", () => {
    const op = buildResizeOperation(makeTarget("box", "Box"), { width: 220, height: 130 }, baseOptions);

    expect(op.type).toBe("resize");
    expect(op.payload).toEqual({ width: 220, height: 130, mode: "box" });
    expect(validateOperationForDom(op).ok).toBe(true);
  });

  it("builds a rotate operation", () => {
    const op = buildRotateOperation(makeTarget("card", "Card"), 42, baseOptions);

    expect(op.type).toBe("rotate");
    expect(op.payload).toEqual({ degrees: 42 });
    expect(validateOperationForDom(op).ok).toBe(true);
  });

  it("builds a z-index operation with the previous layer recorded", () => {
    const op = buildZIndexOperation(makeTarget("layered", "Layered"), 5, 2, baseOptions);

    expect(op.type).toBe("zIndex");
    expect(op.payload).toEqual({ layer: 5, previousLayer: 2 });
    expect(validateOperationForDom(op).ok).toBe(true);
  });

  it("prefers a persistable live-element signature when provided", () => {
    const { document } = createTestDocument(`<main><div class="live">Live</div></main>`);
    const element = document.querySelector(".live") as HTMLElement;
    element.style.position = "absolute";
    document.body.appendChild(element);

    const op = buildZIndexOperation(makeTarget("live", "Live"), 9, 2, baseOptions, element);

    expect(op.target.signature?.cssPath).not.toBe("main .live");
    expect(op.target.signature?.cssPath).toBe(
      buildPersistableElementSignature(element).cssPath,
    );
    expect(validateOperationForDom(op).ok).toBe(true);
  });

  it("builds a hide operation that records the previous display", () => {
    const op = buildHideOperation(makeTarget("hidden", "Hidden"), true, baseOptions, "block");

    expect(op.type).toBe("hide");
    expect(op.payload).toEqual({ hidden: true, previousDisplay: "block" });
    expect(validateOperationForDom(op).ok).toBe(true);
  });

  it("builds a show (hidden:false) operation without a previous display", () => {
    const op = buildHideOperation(makeTarget("shown", "Shown"), false, baseOptions);

    expect(op.type).toBe("hide");
    expect(op.payload).toEqual({ hidden: false });
    expect(validateOperationForDom(op).ok).toBe(true);
  });

  it("builds a crop operation clamping negative insets to zero", () => {
    const op = buildCropOperation(
      makeTarget("cropme", "Crop"),
      { top: 10, right: -5, bottom: 20, left: 0 },
      baseOptions,
    );

    expect(op.type).toBe("crop");
    expect(op.payload).toEqual({ top: 10, right: 0, bottom: 20, left: 0 });
    expect(validateOperationForDom(op).ok).toBe(true);
  });
});
