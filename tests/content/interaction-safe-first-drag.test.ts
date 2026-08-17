import { afterEach, describe, expect, it } from "vitest";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { createTransformController } from "../../src/content/transform-controller.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { extractBoundingBox } from "../../src/editor/measurement/bounding-box.js";
import {
  OTF_INTERACTION_FIXED_ATTR,
  OTF_TRANSFORM_ATTR,
} from "../../src/editor/dom/types.js";
import { createTestDocument } from "../editor/dom/test-document.js";

function createFakeShell(): EditorShell {
  return {
    setHandlePointerDownHandler: () => undefined,
    clearOverlays: () => undefined,
    clearOverlayTranslate: () => undefined,
    translateOverlay: () => undefined,
    renderSelectionOutlines: () => undefined,
  } as unknown as EditorShell;
}

/**
 * Models a host where transform-only placement does not change the layout box
 * used for the subsequent interaction-safe-fixed conversion. First commit
 * must still preserve the requested movement.
 */
function layoutFreshInteractive(
  element: HTMLElement,
  base: { x: number; y: number; width: number; height: number },
): void {
  element.getBoundingClientRect = () => {
    if (element.style.position === "fixed" || element.style.position === "absolute") {
      const x = Number.parseFloat(element.style.left) || base.x;
      const y = Number.parseFloat(element.style.top) || base.y;
      const width = element.style.width ? Number.parseFloat(element.style.width) : base.width;
      const height = element.style.height ? Number.parseFloat(element.style.height) : base.height;
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

    return {
      x: base.x,
      y: base.y,
      width: base.width,
      height: base.height,
      top: base.y,
      left: base.x,
      right: base.x + base.width,
      bottom: base.y + base.height,
      toJSON: () => ({}),
    };
  };
}

function capturePlacement(element: HTMLElement) {
  return {
    rect: extractBoundingBox(element),
    transform: element.style.transform,
    position: element.style.position,
    left: element.style.left,
    top: element.style.top,
    interactionFixed: element.getAttribute(OTF_INTERACTION_FIXED_ATTR),
    storedTransform: element.getAttribute(OTF_TRANSFORM_ATTR),
    parent: element.parentElement?.tagName.toLowerCase() ?? null,
  };
}

describe("interaction-safe-fixed first drag", () => {
  afterEach(() => {
    // controllers created per test; history wrappers are refcounted per window
  });

  it("first committed drag on a fresh interactive anchor keeps the requested geometry", () => {
    const { document } = createTestDocument(
      `<main><a id="cta" href="/submit">Submit</a></main>`,
    );
    const anchor = document.querySelector("#cta") as HTMLAnchorElement;
    const origin = { x: 40, y: 80, width: 160, height: 36 };
    layoutFreshInteractive(anchor, origin);

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => pageCustomization.getPageKey(),
    });

    const target = {
      nodeId: "cta",
      signature: {
        cssPath: "main a#cta",
        tagName: "a",
        idAttr: "cta",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { ...origin },
      element: anchor,
    };

    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...origin }],
      variant: "node",
      handleTarget: target,
    });

    const dx = 120;
    const dy = 40;
    controller.beginMove(origin.x, origin.y);
    const firstOps = controller.endMove(origin.x + dx, origin.y + dy);

    expect(firstOps).toHaveLength(1);
    expect(firstOps[0]?.type).toBe("move");
    if (firstOps[0]?.type === "move") {
      expect(firstOps[0].payload.interactionSafeFixed).toBe(true);
      expect(firstOps[0].payload.dx).toBe(dx);
      expect(firstOps[0].payload.dy).toBe(dy);
    }

    const afterFirst = capturePlacement(anchor);
    expect(afterFirst.interactionFixed).toBe("true");
    expect(afterFirst.rect.x).toBeCloseTo(origin.x + dx, 0);
    expect(afterFirst.rect.y).toBeCloseTo(origin.y + dy, 0);
    expect(afterFirst.position === "fixed" || afterFirst.position === "absolute").toBe(true);

    controller.beginMove(origin.x + dx, origin.y + dy);
    const secondOps = controller.endMove(origin.x + dx + 30, origin.y + dy + 10);
    expect(secondOps).toHaveLength(1);
    if (secondOps[0]?.type === "move") {
      expect(secondOps[0].payload.interactionSafeFixed).toBe(true);
    }

    const afterSecond = capturePlacement(anchor);
    expect(afterSecond.rect.x).toBeCloseTo(origin.x + dx + 30, 0);
    expect(afterSecond.rect.y).toBeCloseTo(origin.y + dy + 10, 0);

    pageCustomization.dispose();
  });
});
