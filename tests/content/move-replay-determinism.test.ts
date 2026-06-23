import { describe, expect, it } from "vitest";
import { DomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";
import { createTransformController } from "../../src/content/transform-controller.js";
import { OTF_DETACH_ATTR } from "../../src/editor/dom/managed-detach.js";
import { extractBoundingBox } from "../../src/editor/measurement/bounding-box.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import type { TransformTarget } from "../../src/editor/transform/index.js";

/**
 * Replay determinism for move -> save -> refresh on a detached element.
 *
 * The harness honors inline width/height and scroll (unlike the older detach
 * mocks that always returned a fixed size at scroll 0), so it reproduces the
 * two replay defects: the saved size being stripped (expand/shrink) and the
 * position being recomputed from the replay-time scroll (shift).
 */

function createFakeShell(): EditorShell {
  return {
    setHandlePointerDownHandler: () => undefined,
    clearOverlays: () => undefined,
    clearOverlayTranslate: () => undefined,
    translateOverlay: () => undefined,
    renderSelectionOutlines: () => undefined,
  } as unknown as EditorShell;
}

const CARD_HTML = `<main><div class="wrap"><section class="card"><h3 class="t">Title</h3></section></div></main>`;

function installRect(
  element: HTMLElement,
  base: { x: number; y: number; width: number; height: number },
  getScroll: () => { x: number; y: number },
): void {
  element.getBoundingClientRect = () => {
    const scroll = getScroll();
    if (element.style.position === "absolute" && element.style.left) {
      const width = element.style.width ? Number.parseFloat(element.style.width) : base.width;
      const height = element.style.height ? Number.parseFloat(element.style.height) : base.height;
      const x = Number.parseFloat(element.style.left) - scroll.x;
      const y = Number.parseFloat(element.style.top) - scroll.y;
      return rect(x, y, width, height);
    }
    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(element.style.transform);
    const dx = match ? Number.parseFloat(match[1] ?? "0") : 0;
    const dy = match ? Number.parseFloat(match[2] ?? "0") : 0;
    return rect(base.x + dx, base.y + dy, base.width, base.height);
  };
}

function rect(x: number, y: number, width: number, height: number): DOMRect {
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
}

function setScroll(document: Document, x: number, y: number): void {
  const view = document.defaultView;
  if (!view) {
    throw new Error("missing window");
  }
  Object.defineProperty(view, "scrollX", { configurable: true, get: () => x });
  Object.defineProperty(view, "scrollY", { configurable: true, get: () => y });
}

function cardTarget(element: HTMLElement, base: { x: number; y: number; width: number; height: number }): TransformTarget {
  return {
    nodeId: "card",
    signature: {
      cssPath: "main div.wrap section.card",
      tagName: "section",
      classList: ["card"],
      boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
    },
    rect: { ...base },
    element,
  };
}

describe("move -> save -> refresh replay determinism", () => {
  it("move far across page -> save -> replay once -> exact rect", () => {
    const base = { x: 60, y: 90, width: 240, height: 160 };

    // --- Save session (scroll at top) ---
    const save = createTestDocument(CARD_HTML);
    const saveCard = save.document.querySelector(".card") as HTMLElement;
    setScroll(save.document, 0, 0);
    installRect(saveCard, base, () => ({ x: 0, y: 0 }));

    const saveAdapter = new DomRuntimeAdapter(save.document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document: save.document,
      adapter: saveAdapter,
      getPageKey: () => "https://example.com/cards",
    });
    const target = cardTarget(saveCard, base);
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...base }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(100, 100);
    const ops = controller.endMove(400, 300); // far move: dx=300, dy=200

    const moveOp = ops[0];
    expect(moveOp?.type).toBe("move");
    if (moveOp?.type !== "move") {
      throw new Error("expected move op");
    }
    expect(moveOp.payload.detached).toBe(true);
    const finalRect = moveOp.metadata?.finalRect;
    expect(finalRect).toBeTruthy();
    const preRefreshRect = extractBoundingBox(saveCard); // page == viewport at scroll 0

    // --- Refresh: fresh DOM, fresh adapter, replay ONCE, scrolled away from top ---
    const reload = createTestDocument(CARD_HTML);
    const reloadCard = reload.document.querySelector(".card") as HTMLElement;
    const replayScroll = { x: 30, y: 90 };
    setScroll(reload.document, replayScroll.x, replayScroll.y);
    installRect(reloadCard, base, () => replayScroll);

    const replayAdapter = new DomRuntimeAdapter(reload.document);
    replayAdapter.replayOperations(ops);

    const replayed = reload.document.querySelector(".card") as HTMLElement;
    expect(replayed.getAttribute(OTF_DETACH_ATTR)).toBe("true");

    // Size must survive replay (the saved width/height, not a collapsed box).
    expect(replayed.style.width).toBe(`${String(finalRect?.width)}px`);
    expect(replayed.style.height).toBe(`${String(finalRect?.height)}px`);

    // Position is the saved page coordinate, independent of the replay scroll.
    expect(replayed.style.left).toBe(`${String(moveOp.payload.detachedLeft)}px`);
    expect(replayed.style.top).toBe(`${String(moveOp.payload.detachedTop)}px`);

    // Page-space rect (viewport + current scroll) matches the pre-refresh rect.
    const replayedViewport = extractBoundingBox(replayed);
    const pageX = replayedViewport.x + replayScroll.x;
    const pageY = replayedViewport.y + replayScroll.y;
    expect(pageX).toBeCloseTo(preRefreshRect.x, 0);
    expect(pageY).toBeCloseTo(preRefreshRect.y, 0);
    expect(replayedViewport.width).toBeCloseTo(preRefreshRect.width, 0);
    expect(replayedViewport.height).toBeCloseTo(preRefreshRect.height, 0);
  });

  it("replay same operation twice -> no geometry change", () => {
    const base = { x: 60, y: 90, width: 240, height: 160 };

    const save = createTestDocument(CARD_HTML);
    const saveCard = save.document.querySelector(".card") as HTMLElement;
    setScroll(save.document, 0, 0);
    installRect(saveCard, base, () => ({ x: 0, y: 0 }));

    const saveAdapter = new DomRuntimeAdapter(save.document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document: save.document,
      adapter: saveAdapter,
      getPageKey: () => "https://example.com/cards",
    });
    const target = cardTarget(saveCard, base);
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...base }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(100, 100);
    const ops = controller.endMove(400, 300);

    const reload = createTestDocument(CARD_HTML);
    const reloadCard = reload.document.querySelector(".card") as HTMLElement;
    setScroll(reload.document, 0, 0);
    installRect(reloadCard, base, () => ({ x: 0, y: 0 }));

    const replayAdapter = new DomRuntimeAdapter(reload.document);
    replayAdapter.replayOperations(ops);

    const first = {
      left: reloadCard.style.left,
      top: reloadCard.style.top,
      width: reloadCard.style.width,
      height: reloadCard.style.height,
      rect: extractBoundingBox(reloadCard),
    };

    // Replaying the same operation again must not move or resize the element.
    replayAdapter.replayOperations(ops);

    expect(reloadCard.style.left).toBe(first.left);
    expect(reloadCard.style.top).toBe(first.top);
    expect(reloadCard.style.width).toBe(first.width);
    expect(reloadCard.style.height).toBe(first.height);
    const second = extractBoundingBox(reloadCard);
    expect(second.x).toBeCloseTo(first.rect.x, 0);
    expect(second.y).toBeCloseTo(first.rect.y, 0);
    expect(second.width).toBeCloseTo(first.rect.width, 0);
    expect(second.height).toBeCloseTo(first.rect.height, 0);
  });
});
