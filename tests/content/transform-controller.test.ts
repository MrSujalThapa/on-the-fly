import { describe, expect, it } from "vitest";
import { DomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import type { ElementSignature } from "../../src/editor/element-signature.js";
import type { VisualNodeRect } from "../../src/editor/visual-node.js";
import type { TransformTarget } from "../../src/editor/transform/transform-target.js";
import {
  createTransformController,
  type TransformSelectionInput,
} from "../../src/content/transform-controller.js";
import type { EditorShell } from "../../src/content/editor-shell.js";
import { createTestDocument } from "../editor/dom/test-document.js";

type HandlePointerDownHandler = (handleId: string, event: PointerEvent) => void;

interface FakeShell {
  shell: EditorShell;
  outlineCalls: { rects: VisualNodeRect[]; variant: string; handles: boolean }[];
  getHandleHandler: () => HandlePointerDownHandler | null;
}

function createFakeShell(): FakeShell {
  const outlineCalls: FakeShell["outlineCalls"] = [];
  let handleHandler: HandlePointerDownHandler | null = null;
  const shell = {
    setHandlePointerDownHandler: (handler: HandlePointerDownHandler | null) => {
      handleHandler = handler;
    },
    clearOverlays: () => undefined,
    clearOverlayTranslate: () => undefined,
    translateOverlay: () => undefined,
    renderSelectionOutlines: (
      rects: VisualNodeRect[],
      variant: string,
      options: { handles?: boolean } = {},
    ) => {
      outlineCalls.push({ rects: rects.map((rect) => ({ ...rect })), variant, handles: options.handles === true });
    },
  } as unknown as EditorShell;

  return { shell, outlineCalls, getHandleHandler: () => handleHandler };
}

/** Drives a resize gesture through the controller's real handle pointer path. */
function simulateResize(
  document: Document,
  handleHandler: HandlePointerDownHandler | null,
  handleId: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  options: { altKey?: boolean; endType?: "pointerup" | "pointercancel" } = {},
): void {
  const view = document.defaultView as unknown as typeof globalThis;
  const down = new view.PointerEvent("pointerdown", {
    clientX: startX,
    clientY: startY,
    pointerId: 1,
    altKey: options.altKey === true,
  });
  handleHandler?.(handleId, down);
  view.dispatchEvent(new view.PointerEvent("pointermove", { clientX: endX, clientY: endY, pointerId: 1 }));
  view.dispatchEvent(new view.PointerEvent(options.endType ?? "pointerup", {
    clientX: endX,
    clientY: endY,
    pointerId: 1,
  }));
}

function layoutResizable(element: HTMLElement, base: VisualNodeRect): void {
  element.getBoundingClientRect = () => {
    const { dx, dy } = parseTranslate(element.style.transform);
    const width = element.style.width ? Number.parseFloat(element.style.width) : base.width;
    const height = element.style.height ? Number.parseFloat(element.style.height) : base.height;
    const x = base.x + dx;
    const y = base.y + dy;
    return {
      x,
      y,
      width,
      height,
      top: y,
      left: x,
      right: x + width,
      bottom: y + height,
      toJSON: () => ({}),
    };
  };
}

function parseTranslate(transform: string): { dx: number; dy: number } {
  const match = /translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/.exec(transform);
  if (!match) {
    return { dx: 0, dy: 0 };
  }
  return { dx: Number(match[1]), dy: Number(match[2]) };
}

function layoutWithTransform(element: HTMLElement, base: VisualNodeRect): void {
  element.getBoundingClientRect = () => {
    const { dx, dy } = parseTranslate(element.style.transform);
    const x = base.x + dx;
    const y = base.y + dy;
    return {
      x,
      y,
      width: base.width,
      height: base.height,
      top: y,
      left: x,
      right: x + base.width,
      bottom: y + base.height,
      toJSON: () => ({}),
    };
  };
}

function signatureFor(className: string, text: string): ElementSignature {
  return {
    cssPath: `main .${className}`,
    tagName: "div",
    classList: [className],
    textFingerprint: text,
    boundingBoxHint: createEmptyBoundingBoxHint(),
  };
}

function makeTarget(className: string, text: string, rect: VisualNodeRect): TransformTarget {
  return { nodeId: className, signature: signatureFor(className, text), rect };
}

function nodeInput(targets: TransformTarget[]): TransformSelectionInput {
  return {
    targets,
    outlineRects: targets.map((target) => ({ ...target.rect })),
    variant: "node",
    handleTarget: targets.length === 1 ? (targets[0] ?? null) : null,
  };
}

describe("TransformController", () => {
  it("commits a single move into a move operation applied to the DOM", () => {
    const { document } = createTestDocument(
      `<main><div class="box-a">Box A</div></main>`,
    );
    const elementA = document.querySelector(".box-a") as HTMLElement;
    layoutWithTransform(elementA, { x: 20, y: 20, width: 100, height: 40 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target = makeTarget("box-a", "Box A", { x: 20, y: 20, width: 100, height: 40 });
    controller.setSelection(nodeInput([target]));

    controller.beginMove(50, 50);
    controller.updateMove(70, 80);
    const ops = controller.endMove(70, 80);

    expect(ops).toHaveLength(1);
    expect(ops[0]?.type).toBe("move");
    expect(ops[0]?.payload).toEqual({ dx: 20, dy: 30 });
    expect(elementA.style.transform).toContain("translate(20px, 30px)");
  });

  it("moves every member of a group together", () => {
    const { document } = createTestDocument(
      `<main><div class="box-a">Box A</div><div class="box-b">Box B</div></main>`,
    );
    const elementA = document.querySelector(".box-a") as HTMLElement;
    const elementB = document.querySelector(".box-b") as HTMLElement;
    layoutWithTransform(elementA, { x: 20, y: 20, width: 100, height: 40 });
    layoutWithTransform(elementB, { x: 20, y: 80, width: 100, height: 40 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const targets = [
      makeTarget("box-a", "Box A", { x: 20, y: 20, width: 100, height: 40 }),
      makeTarget("box-b", "Box B", { x: 20, y: 80, width: 100, height: 40 }),
    ];
    controller.setSelection({
      targets,
      outlineRects: [{ x: 20, y: 20, width: 100, height: 100 }],
      variant: "group",
      handleTarget: null,
    });

    controller.beginMove(40, 40);
    controller.updateMove(55, 65);
    const ops = controller.endMove(55, 65);

    expect(ops).toHaveLength(2);
    expect(elementA.style.transform).toContain("translate(15px, 25px)");
    expect(elementB.style.transform).toContain("translate(15px, 25px)");
  });

  it("recomputes the outline after a move", () => {
    const { document } = createTestDocument(
      `<main><div class="box-a">Box A</div></main>`,
    );
    const elementA = document.querySelector(".box-a") as HTMLElement;
    layoutWithTransform(elementA, { x: 20, y: 20, width: 100, height: 40 });

    const { shell, outlineCalls } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target = makeTarget("box-a", "Box A", { x: 20, y: 20, width: 100, height: 40 });
    controller.setSelection(nodeInput([target]));

    controller.beginMove(50, 50);
    controller.updateMove(80, 90);
    controller.endMove(80, 90);

    const lastOutline = outlineCalls.at(-1);
    expect(lastOutline?.rects[0]).toEqual({ x: 50, y: 60, width: 100, height: 40 });
  });

  it("generates a z-index operation from a layer command", () => {
    const { document } = createTestDocument(
      `<main><div class="box-a">Box A</div></main>`,
    );
    const elementA = document.querySelector(".box-a") as HTMLElement;
    layoutWithTransform(elementA, { x: 20, y: 20, width: 100, height: 40 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target = makeTarget("box-a", "Box A", { x: 20, y: 20, width: 100, height: 40 });
    controller.setSelection(nodeInput([target]));

    const ops = controller.applyLayerCommand("forward");

    expect(ops).toHaveLength(1);
    expect(ops[0]?.type).toBe("zIndex");
    // A fresh managed element sits on the managed baseline (1); forward → 2.
    expect(ops[0]?.payload).toEqual({ layer: 2, previousLayer: 1 });
    expect(elementA.style.zIndex).toBe("2");
  });

  it("uses the live element reference when the signature no longer matches", () => {
    const { document } = createTestDocument(
      `<main><section class="card"><p class="copy">Card copy</p></section></main>`,
    );
    const card = document.querySelector(".card") as HTMLElement;
    layoutWithTransform(card, { x: 40, y: 40, width: 300, height: 160 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    // Signature deliberately points at a non-existent element: only the live
    // DOM-first element reference can resolve this synthetic target.
    const target: TransformTarget = {
      nodeId: "otf-rect-0",
      signature: signatureFor("does-not-exist", "no match"),
      rect: { x: 40, y: 40, width: 300, height: 160 },
      element: card,
    };
    controller.setSelection(nodeInput([target]));

    controller.beginMove(60, 60);
    controller.updateMove(90, 110);
    const ops = controller.endMove(90, 110);

    expect(ops).toHaveLength(1);
    expect(ops[0]?.type).toBe("move");
    expect(card.style.transform).toContain("translate(30px, 50px)");
  });

  it("moves a card/background container itself, not its child text", () => {
    const { document } = createTestDocument(
      `<main><section class="card"><p class="copy">Card copy</p></section></main>`,
    );
    const card = document.querySelector(".card") as HTMLElement;
    const copy = document.querySelector(".copy") as HTMLElement;
    layoutWithTransform(card, { x: 40, y: 40, width: 300, height: 160 });
    layoutWithTransform(copy, { x: 50, y: 60, width: 200, height: 20 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target: TransformTarget = {
      nodeId: "otf-rect-0",
      signature: signatureFor("card", "Card copy"),
      rect: { x: 40, y: 40, width: 300, height: 160 },
      element: card,
    };
    controller.setSelection(nodeInput([target]));

    controller.beginMove(60, 60);
    controller.updateMove(75, 85);
    controller.endMove(75, 85);

    expect(card.style.transform).toContain("translate(15px, 25px)");
    expect(copy.style.transform).toBe("");
  });

  it("resizes a card/background container with safe box-sizing", () => {
    const { document } = createTestDocument(
      `<main><section class="card"><p class="copy">Card copy</p></section></main>`,
    );
    const card = document.querySelector(".card") as HTMLElement;
    layoutResizable(card, { x: 40, y: 40, width: 300, height: 160 });

    const { shell, getHandleHandler } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target: TransformTarget = {
      nodeId: "otf-rect-0",
      signature: signatureFor("card", "Card copy"),
      rect: { x: 40, y: 40, width: 300, height: 160 },
      element: card,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });

    simulateResize(document, getHandleHandler(), "se", 100, 100, 150, 130);

    expect(card.style.width).toBe("350px");
    expect(card.style.height).toBe("190px");
    expect(card.style.boxSizing).toBe("border-box");
  });

  it("sets position relative when applying z-index to a static element", () => {
    const { document } = createTestDocument(
      `<main><div class="box-a">Box A</div></main>`,
    );
    const elementA = document.querySelector(".box-a") as HTMLElement;
    layoutWithTransform(elementA, { x: 20, y: 20, width: 100, height: 40 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target = makeTarget("box-a", "Box A", { x: 20, y: 20, width: 100, height: 40 });
    controller.setSelection(nodeInput([target]));

    controller.applyLayerCommand("front");

    expect(elementA.style.position).toBe("relative");
    expect(elementA.style.zIndex).toBe("2147483000");
  });

  it("hides the selection via a hide operation and clears the overlay", () => {
    const { document } = createTestDocument(
      `<main><div class="box-a">Box A</div></main>`,
    );
    const elementA = document.querySelector(".box-a") as HTMLElement;
    layoutWithTransform(elementA, { x: 20, y: 20, width: 100, height: 40 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const applied: string[] = [];
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
      onApply: (ops) => {
        ops.forEach((op) => {
          applied.push(op.type);
        });
      },
    });

    const target = makeTarget("box-a", "Box A", { x: 20, y: 20, width: 100, height: 40 });
    controller.setSelection(nodeInput([target]));

    const ops = controller.hideSelection();

    expect(ops).toHaveLength(1);
    expect(ops[0]?.type).toBe("hide");
    expect((ops[0]?.payload as { hidden: boolean }).hidden).toBe(true);
    expect(elementA.style.display).toBe("none");
    expect(applied).toContain("hide");
  });

  it("does not create a hide operation when the target is already hidden", () => {
    const { document } = createTestDocument(
      `<main><div class="box-a">Box A</div></main>`,
    );
    const elementA = document.querySelector(".box-a") as HTMLElement;
    layoutWithTransform(elementA, { x: 20, y: 20, width: 100, height: 40 });
    elementA.style.display = "none";

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const applied: string[] = [];
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
      onApply: (ops) => {
        ops.forEach((op) => {
          applied.push(op.type);
        });
      },
    });

    const target = makeTarget("box-a", "Box A", { x: 20, y: 20, width: 100, height: 40 });
    controller.setSelection(nodeInput([target]));

    const ops = controller.hideSelection();

    expect(ops).toEqual([]);
    expect(applied).toEqual([]);
    expect(elementA.style.display).toBe("none");
  });

  it("clears selection state after hide via clearSelection", () => {
    const { document } = createTestDocument(
      `<main><div class="box-a">Box A</div></main>`,
    );
    const elementA = document.querySelector(".box-a") as HTMLElement;
    layoutWithTransform(elementA, { x: 20, y: 20, width: 100, height: 40 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target = makeTarget("box-a", "Box A", { x: 20, y: 20, width: 100, height: 40 });
    controller.setSelection(nodeInput([target]));
    expect(controller.hasSelection()).toBe(true);

    controller.hideSelection();
    controller.clearSelection();

    expect(controller.hasSelection()).toBe(false);
  });

  it("toggles a hidden element back to visible", () => {
    const { document } = createTestDocument(
      `<main><div class="box-a">Box A</div></main>`,
    );
    const elementA = document.querySelector(".box-a") as HTMLElement;
    layoutWithTransform(elementA, { x: 20, y: 20, width: 100, height: 40 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target = makeTarget("box-a", "Box A", { x: 20, y: 20, width: 100, height: 40 });
    controller.setSelection(nodeInput([target]));

    controller.toggleHideSelection();
    expect(elementA.style.display).toBe("none");

    const showOps = controller.toggleHideSelection();
    expect(showOps[0]?.type).toBe("hide");
    expect((showOps[0]?.payload as { hidden: boolean }).hidden).toBe(false);
    expect(elementA.style.display).not.toBe("none");
  });

  it("crops the handle target with inline clip-path without resizing it", () => {
    const { document } = createTestDocument(
      `<main><img class="photo" alt="x" /></main>`,
    );
    const image = document.querySelector(".photo") as HTMLElement;
    layoutResizable(image, { x: 0, y: 0, width: 200, height: 160 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target: TransformTarget = {
      nodeId: "photo",
      signature: signatureFor("photo", ""),
      rect: { x: 0, y: 0, width: 200, height: 160 },
      element: image,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });

    const ops = controller.cropSelection({ top: 10, right: 20, bottom: 0, left: 5 });

    expect(ops).toHaveLength(1);
    expect(ops[0]?.type).toBe("crop");
    expect(image.style.clipPath).toBe("inset(10px 20px 0px 5px)");
    // Crop must not stretch/resize the element.
    expect(image.style.width).toBe("");
    expect(image.style.height).toBe("");
  });

  it("updates the outline to the visible cropped rect after crop", () => {
    const { document } = createTestDocument(
      `<main><img class="photo" alt="x" /></main>`,
    );
    const image = document.querySelector(".photo") as HTMLElement;
    layoutResizable(image, { x: 0, y: 0, width: 200, height: 160 });

    const { shell, outlineCalls } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target: TransformTarget = {
      nodeId: "photo",
      signature: signatureFor("photo", ""),
      rect: { x: 0, y: 0, width: 200, height: 160 },
      element: image,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });

    controller.cropSelection({ top: 10, right: 20, bottom: 5, left: 15 });

    const lastOutline = outlineCalls.at(-1);
    expect(lastOutline?.rects[0]).toEqual({ x: 15, y: 10, width: 165, height: 145 });
  });

  it("repeated crop composes from the current stored crop state", () => {
    const { document } = createTestDocument(
      `<main><img class="photo" alt="x" /></main>`,
    );
    const image = document.querySelector(".photo") as HTMLElement;
    layoutResizable(image, { x: 0, y: 0, width: 200, height: 160 });

    const { shell, outlineCalls, getHandleHandler } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target: TransformTarget = {
      nodeId: "photo",
      signature: signatureFor("photo", ""),
      rect: { x: 0, y: 0, width: 200, height: 160 },
      element: image,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.cropSelection({ top: 0, right: 20, bottom: 0, left: 10 });

    controller.setCropMode(true);
    simulateResize(document, getHandleHandler(), "e", 180, 80, 170, 80);

    expect(image.style.clipPath).toBe("inset(0px 30px 0px 10px)");
    const lastOutline = outlineCalls.at(-1);
    expect(lastOutline?.rects[0]).toEqual({ x: 10, y: 0, width: 160, height: 160 });
  });

  it("does not crop from an Alt resize handle drag unless crop mode is active", () => {
    const { document } = createTestDocument(
      `<main><img class="photo" alt="x" /></main>`,
    );
    const image = document.querySelector(".photo") as HTMLElement;
    layoutResizable(image, { x: 0, y: 0, width: 200, height: 160 });

    const { shell, getHandleHandler } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target: TransformTarget = {
      nodeId: "photo",
      signature: signatureFor("photo", ""),
      rect: { x: 0, y: 0, width: 200, height: 160 },
      element: image,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });

    simulateResize(document, getHandleHandler(), "e", 200, 80, 180, 80, { altKey: true });

    expect(image.style.clipPath).toBe("");
    expect(image.style.width).toBe("180px");
  });

  it("exits crop mode after pointerup", () => {
    const { document } = createTestDocument(
      `<main><img class="photo" alt="x" /></main>`,
    );
    const image = document.querySelector(".photo") as HTMLElement;
    layoutResizable(image, { x: 0, y: 0, width: 200, height: 160 });

    const { shell, getHandleHandler } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target: TransformTarget = {
      nodeId: "photo",
      signature: signatureFor("photo", ""),
      rect: { x: 0, y: 0, width: 200, height: 160 },
      element: image,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });

    expect(controller.setCropMode(true)).toBe(true);
    simulateResize(document, getHandleHandler(), "e", 200, 80, 180, 80);

    expect(controller.isCropMode()).toBe(false);
  });

  it("exits crop mode and restores preview on pointercancel", () => {
    const { document } = createTestDocument(
      `<main><img class="photo" alt="x" /></main>`,
    );
    const image = document.querySelector(".photo") as HTMLElement;
    layoutResizable(image, { x: 0, y: 0, width: 200, height: 160 });

    const { shell, getHandleHandler } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target: TransformTarget = {
      nodeId: "photo",
      signature: signatureFor("photo", ""),
      rect: { x: 0, y: 0, width: 200, height: 160 },
      element: image,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });

    controller.setCropMode(true);
    simulateResize(document, getHandleHandler(), "e", 200, 80, 180, 80, { endType: "pointercancel" });

    expect(controller.isCropMode()).toBe(false);
    expect(image.style.clipPath).toBe("");
  });

  it("cancels resize preview on pointercancel", () => {
    const { document } = createTestDocument(
      `<main><section class="card">Card</section></main>`,
    );
    const card = document.querySelector(".card") as HTMLElement;
    layoutResizable(card, { x: 0, y: 0, width: 200, height: 160 });

    const { shell, getHandleHandler } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target: TransformTarget = {
      nodeId: "card",
      signature: signatureFor("card", "Card"),
      rect: { x: 0, y: 0, width: 200, height: 160 },
      element: card,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });

    simulateResize(document, getHandleHandler(), "e", 200, 80, 240, 80, { endType: "pointercancel" });

    expect(controller.isTransforming()).toBe(false);
    expect(card.style.width).toBe("");
    expect(card.style.height).toBe("");
  });

  it("cancels an active crop preview on window blur", () => {
    const { document } = createTestDocument(
      `<main><img class="photo" alt="x" /></main>`,
    );
    const image = document.querySelector(".photo") as HTMLElement;
    layoutResizable(image, { x: 0, y: 0, width: 200, height: 160 });

    const { shell, getHandleHandler } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target: TransformTarget = {
      nodeId: "photo",
      signature: signatureFor("photo", ""),
      rect: { x: 0, y: 0, width: 200, height: 160 },
      element: image,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });

    controller.setCropMode(true);
    const view = document.defaultView as unknown as typeof globalThis;
    const down = new view.PointerEvent("pointerdown", {
      clientX: 200,
      clientY: 80,
      pointerId: 1,
    });
    getHandleHandler()?.("e", down);
    view.dispatchEvent(new view.PointerEvent("pointermove", { clientX: 180, clientY: 80, pointerId: 1 }));
    view.dispatchEvent(new view.Event("blur"));

    expect(controller.isCropMode()).toBe(false);
    expect(controller.isTransforming()).toBe(false);
    expect(image.style.clipPath).toBe("");
  });

  it("disables crop for group and giant wrapper selections", () => {
    const { document } = createTestDocument(
      `<main><section class="giant">Large</section><section class="card">Card</section></main>`,
    );
    const giant = document.querySelector(".giant") as HTMLElement;
    const card = document.querySelector(".card") as HTMLElement;
    Object.defineProperty(document.defaultView, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(document.defaultView, "innerHeight", { configurable: true, value: 800 });
    layoutResizable(giant, { x: 0, y: 0, width: 960, height: 900 });
    layoutResizable(card, { x: 20, y: 20, width: 200, height: 120 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const groupTarget = makeTarget("card", "Card", { x: 20, y: 20, width: 200, height: 120 });
    controller.setSelection({
      targets: [groupTarget],
      outlineRects: [{ ...groupTarget.rect }],
      variant: "group",
      handleTarget: null,
    });
    expect(controller.setCropMode(true)).toBe(false);

    const giantTarget: TransformTarget = {
      nodeId: "giant",
      signature: signatureFor("giant", "Large"),
      rect: { x: 0, y: 0, width: 960, height: 900 },
      element: giant,
    };
    controller.setSelection({
      targets: [giantTarget],
      outlineRects: [{ ...giantTarget.rect }],
      variant: "node",
      handleTarget: giantTarget,
    });
    expect(controller.setCropMode(true)).toBe(false);
  });

  it("recomputes the outline after a resize", () => {
    const { document } = createTestDocument(
      `<main><section class="card"><p class="copy">Card copy</p></section></main>`,
    );
    const card = document.querySelector(".card") as HTMLElement;
    layoutResizable(card, { x: 40, y: 40, width: 300, height: 160 });

    const { shell, outlineCalls, getHandleHandler } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target: TransformTarget = {
      nodeId: "otf-rect-0",
      signature: signatureFor("card", "Card copy"),
      rect: { x: 40, y: 40, width: 300, height: 160 },
      element: card,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });

    simulateResize(document, getHandleHandler(), "se", 100, 100, 140, 120);

    const lastOutline = outlineCalls.at(-1);
    expect(lastOutline?.rects[0]?.width).toBe(340);
    expect(lastOutline?.rects[0]?.height).toBe(180);
  });
});
