import { describe, expect, it } from "vitest";
import { DomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";
import { OTF_DETACH_ATTR } from "../../src/editor/dom/managed-detach.js";
import { createTransformController, type TransformSelectionInput } from "../../src/content/transform-controller.js";
import type { EditorShell } from "../../src/content/editor-shell.js";
import { createTestDocument } from "../editor/dom/test-document.js";

function createFakeShell() {
  const shell = {
    setHandlePointerDownHandler: () => undefined,
    clearOverlays: () => undefined,
    clearOverlayTranslate: () => undefined,
    translateOverlay: () => undefined,
    renderSelectionOutlines: () => undefined,
  } as unknown as EditorShell;
  return { shell };
}

function layoutElement(
  element: HTMLElement,
  base: { x: number; y: number; width: number; height: number },
): void {
  element.getBoundingClientRect = () => {
    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(element.style.transform);
    const dx = match ? Number.parseFloat(match[1] ?? "0") : 0;
    const dy = match ? Number.parseFloat(match[2] ?? "0") : 0;
    const x = element.style.left
      ? Number.parseFloat(element.style.left)
      : base.x + dx;
    const y = element.style.top
      ? Number.parseFloat(element.style.top)
      : base.y + dy;
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

function nodeInput(target: TransformSelectionInput["targets"][number]): TransformSelectionInput {
  return {
    targets: [target],
    outlineRects: [{ ...target.rect }],
    variant: "node",
    handleTarget: target,
  };
}

describe("detached child transform hierarchy", () => {
  it("keeps moved buttons transform-only and preserves replay without detach", () => {
    const { document, root } = createTestDocument(
      `<main><section class="card"><button class="premium">Reactivate Premium</button></section></main>`,
    );
    const card = document.querySelector(".card") as HTMLElement;
    const button = document.querySelector(".premium") as HTMLElement;
    layoutElement(card, { x: 40, y: 40, width: 300, height: 160 });
    layoutElement(button, { x: 50, y: 60, width: 180, height: 36 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const buttonTarget = {
      nodeId: "premium",
      signature: {
        cssPath: "main section.card > button.premium",
        tagName: "button",
        classList: ["premium"],
        textFingerprint: "Reactivate Premium",
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 50, y: 60, width: 180, height: 36 },
      element: button,
    };

    controller.setSelection(nodeInput(buttonTarget));
    controller.beginMove(50, 60);
    const moveOps = controller.endMove(350, 60);
    expect(moveOps[0]?.type).toBe("move");
    if (moveOps[0]?.type === "move") {
      expect(moveOps[0].payload.detached).not.toBe(true);
    }
    expect(button.getAttribute("data-otf-detached")).not.toBe("true");
    expect(button.parentElement).toBe(card);

    const replayAdapter = new DomRuntimeAdapter(root);
    replayAdapter.replayOperations(moveOps);
    const replayed = document.querySelector(".premium") as HTMLElement;
    expect(replayed.getAttribute("data-otf-detached")).not.toBe("true");
    expect(replayed.parentElement).toBe(card);
  });

  it("still moves grouped parent and child together when both are selected", () => {
    const { document } = createTestDocument(
      `<main><section class="card"><p class="copy">Card copy</p></section></main>`,
    );
    const card = document.querySelector(".card") as HTMLElement;
    const copy = document.querySelector(".copy") as HTMLElement;
    layoutElement(card, { x: 40, y: 40, width: 300, height: 160 });
    layoutElement(copy, { x: 50, y: 60, width: 200, height: 20 });

    const { shell } = createFakeShell();
    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const cardTarget = {
      nodeId: "card",
      signature: {
        cssPath: "main section.card",
        tagName: "section",
        classList: ["card"],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 40, y: 40, width: 300, height: 160 },
      element: card,
    };
    const childTarget = {
      nodeId: "copy",
      signature: {
        cssPath: "main p.copy",
        tagName: "p",
        classList: ["copy"],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 50, y: 60, width: 200, height: 20 },
      element: copy,
    };

    controller.setSelection({
      targets: [cardTarget, childTarget],
      outlineRects: [{ x: 40, y: 40, width: 300, height: 160 }],
      variant: "group",
      handleTarget: null,
    });

    const beforeChild = copy.getBoundingClientRect();
    controller.beginMove(60, 60);
    controller.endMove(80, 80);

    const afterChild = copy.getBoundingClientRect();
    expect(afterChild.x).toBeCloseTo(beforeChild.x + 20, 0);
    expect(afterChild.y).toBeCloseTo(beforeChild.y + 20, 0);
    expect(copy.getAttribute(OTF_DETACH_ATTR)).not.toBe("true");
  });
});
