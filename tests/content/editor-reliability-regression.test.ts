import { afterEach, describe, expect, it, vi } from "vitest";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { createTransformController } from "../../src/content/transform-controller.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { FRONT_LAYER } from "../../src/editor/transform/layer-order.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { layoutElement, layoutManagedElement } from "../editor/measurement/layout-helpers.js";
import * as storageClient from "../../src/content/storage-client.js";

function createFakeShell(): EditorShell {
  return {
    setHandlePointerDownHandler: () => undefined,
    clearOverlays: () => undefined,
    clearOverlayTranslate: () => undefined,
    translateOverlay: () => undefined,
    renderSelectionOutlines: () => undefined,
  } as unknown as EditorShell;
}

function layoutWithTransform(
  element: HTMLElement,
  base: { x: number; y: number; width: number; height: number },
): void {
  layoutManagedElement(element, base);
}

describe("editor layering and interactive regressions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("live bring front changes zIndex immediately", () => {
    const { document } = createTestDocument(`<main><div class="box-a">A</div></main>`);
    const box = document.querySelector(".box-a") as HTMLElement;
    layoutWithTransform(box, { x: 20, y: 20, width: 100, height: 40 });

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://example.com/",
    });

    controller.setSelection({
      targets: [
        {
          nodeId: "box-a",
          signature: {
            cssPath: "main div.box-a",
            tagName: "div",
            classList: ["box-a"],
            boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
          },
          rect: { x: 20, y: 20, width: 100, height: 40 },
          element: box,
        },
      ],
      outlineRects: [{ x: 20, y: 20, width: 100, height: 40 }],
      variant: "node",
      handleTarget: null,
    });

    controller.applyLayerCommand("front");
    expect(box.style.zIndex).toBe(String(FRONT_LAYER));
  });

  it("save + refresh preserves latest layer", async () => {
    const { document } = createTestDocument(`<main><div class="box-a">A</div></main>`);
    const box = document.querySelector(".box-a") as HTMLElement;
    layoutWithTransform(box, { x: 20, y: 20, width: 100, height: 40 });

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://example.com/",
    });

    const target = {
      nodeId: "box-a",
      signature: {
        cssPath: "main div.box-a",
        tagName: "div",
        classList: ["box-a"],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 20, y: 20, width: 100, height: 40 },
      element: box,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ x: 20, y: 20, width: 100, height: 40 }],
      variant: "node",
      handleTarget: target,
    });
    controller.applyLayerCommand("front");
    controller.applyLayerCommand("back");
    const ops = controller.applyLayerCommand("front");
    pageCustomization.setPageOperations(ops);

    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue(ops);

    box.removeAttribute("style");
    const afterRefresh = new PageCustomizationController(document);
    await afterRefresh.ensureReplayed();

    expect(box.style.zIndex).toBe(String(FRONT_LAYER));
  });

  it("moved tab still bubbles click to app root after replay (edit off)", () => {
    const { document } = createTestDocument(
      `<main id="app-root"><nav class="tabs"><button class="tab" role="tab">Settings</button></nav></main>`,
    );
    const appRoot = document.querySelector("#app-root") as HTMLElement;
    const tab = document.querySelector(".tab") as HTMLButtonElement;
    layoutElement(appRoot, { x: 0, y: 0, width: 800, height: 600 });
    layoutWithTransform(tab, { x: 20, y: 20, width: 120, height: 36 });

    const rootClick = vi.fn();
    appRoot.addEventListener("click", rootClick);

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://example.com/app",
    });

    const target = {
      nodeId: "settings-tab",
      signature: {
        cssPath: "main#app-root nav.tabs > button.tab",
        tagName: "button",
        classList: ["tab"],
        role: "tab",
        textFingerprint: "Settings",
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 20, y: 20, width: 120, height: 36 },
      element: tab,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ x: 20, y: 20, width: 120, height: 36 }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(20, 20);
    const moveOps = controller.endMove(260, 20);
    expect(moveOps[0]?.type).toBe("move");
    if (moveOps[0]?.type === "move") {
      expect(moveOps[0].payload.interactionSafeFixed).toBe(true);
      expect(moveOps[0].payload.detached).not.toBe(true);
    }

    tab.removeAttribute("style");
    tab.removeAttribute("data-otf-managed");
    tab.removeAttribute("data-otf-transform");
    tab.removeAttribute("data-otf-interaction-fixed");
    layoutWithTransform(tab, { x: 20, y: 20, width: 120, height: 36 });

    pageCustomization.getAdapter().replayOperations(moveOps);
    tab.click();

    expect(rootClick).toHaveBeenCalledTimes(1);
    expect(tab.parentElement?.classList.contains("tabs")).toBe(true);
    expect(tab.parentElement?.parentElement).toBe(appRoot);
  });
});
