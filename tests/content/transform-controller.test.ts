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
): void {
  const view = document.defaultView as unknown as typeof globalThis;
  const down = new view.PointerEvent("pointerdown", { clientX: startX, clientY: startY });
  handleHandler?.(handleId, down);
  view.dispatchEvent(new view.PointerEvent("pointermove", { clientX: endX, clientY: endY }));
  view.dispatchEvent(new view.PointerEvent("pointerup", { clientX: endX, clientY: endY }));
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
