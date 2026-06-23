import { afterEach, describe, expect, it, vi } from "vitest";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { createTransformController } from "../../src/content/transform-controller.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { extractBoundingBox } from "../../src/editor/measurement/bounding-box.js";
import { FRONT_LAYER } from "../../src/editor/transform/layer-order.js";
import { OTF_INTERACTION_FIXED_ATTR, OTF_TRANSFORM_ONLY_ATTR } from "../../src/editor/dom/types.js";
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

describe("interaction-safe fixed move replay", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("standalone button uses interaction-safe fixed and remains clickable after replay", () => {
    const { document } = createTestDocument(
      `<main><button id="premium">Reactivate Premium</button></main>`,
    );
    const button = document.querySelector("#premium") as HTMLButtonElement;
    layoutManagedElement(button, { x: 50, y: 60, width: 180, height: 36 });

    const clickSpy = vi.fn();
    button.addEventListener("click", clickSpy);

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://example.com/",
    });

    const target = {
      nodeId: "premium",
      signature: {
        cssPath: "main button#premium",
        tagName: "button",
        idAttr: "premium",
        classList: [],
        textFingerprint: "Reactivate Premium",
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 50, y: 60, width: 180, height: 36 },
      element: button,
    };

    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(50, 60);
    const moveOps = controller.endMove(350, 60);

    expect(moveOps[0]?.type).toBe("move");
    if (moveOps[0]?.type === "move") {
      expect(moveOps[0].payload.interactionSafeFixed).toBe(true);
      expect(moveOps[0].payload.fixedViewportLeft).toBe(350);
    }

    button.removeAttribute("style");
    button.removeAttribute("data-otf-managed");
    button.removeAttribute("data-otf-transform");
    button.removeAttribute(OTF_INTERACTION_FIXED_ATTR);
    layoutManagedElement(button, { x: 50, y: 60, width: 180, height: 36 });

    const replayCustomization = new PageCustomizationController(document);
    replayCustomization.getAdapter().replayOperations(moveOps);
    button.click();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(button.style.position === "fixed" || button.style.position === "absolute").toBe(true);
  });

  it("tablist chips move as transform-only group preserving filter clicks", () => {
    const { document } = createTestDocument("");
    document.body.innerHTML = `
      <main id="app-root">
        <nav class="tabs" role="tablist">
          <button role="tab" data-tab="all">All</button>
          <button role="tab" data-tab="jobs">Jobs</button>
        </nav>
      </main>
    `;
    const tablist = document.querySelector(".tabs") as HTMLElement;
    const jobs = document.querySelector('[data-tab="jobs"]') as HTMLButtonElement;
    layoutElement(tablist, { x: 16, y: 72, width: 220, height: 40 });
    layoutManagedElement(jobs, { x: 120, y: 72, width: 72, height: 32 });

    const filterChanges = vi.fn();
    tablist.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.dataset.tab) {
        filterChanges(target.dataset.tab);
      }
    });

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://example.com/feed",
    });

    const target = {
      nodeId: "jobs-tab",
      signature: {
        cssPath: 'main#app-root nav.tabs > button[data-tab="jobs"]',
        tagName: "button",
        classList: [],
        role: "tab",
        textFingerprint: "Jobs",
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 120, y: 72, width: 72, height: 32 },
      element: jobs,
    };

    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(120, 72);
    const moveOps = controller.endMove(320, 72);

    expect(tablist.getAttribute(OTF_TRANSFORM_ONLY_ATTR)).toBe("true");
    expect(tablist.getAttribute(OTF_INTERACTION_FIXED_ATTR)).not.toBe("true");
    if (moveOps[0]?.type === "move") {
      expect(moveOps[0].payload.interactionSafeFixed).toBe(false);
      expect(moveOps[0].payload.detached).not.toBe(true);
    }

    tablist.removeAttribute("style");
    tablist.removeAttribute("data-otf-managed");
    tablist.removeAttribute("data-otf-transform");
    tablist.removeAttribute(OTF_TRANSFORM_ONLY_ATTR);
    layoutElement(tablist, { x: 16, y: 72, width: 220, height: 40 });
    layoutManagedElement(jobs, { x: 120, y: 72, width: 72, height: 32 });

    const replayCustomization = new PageCustomizationController(document);
    replayCustomization.getAdapter().replayOperations(moveOps);
    layoutManagedElement(tablist, { x: 16, y: 72, width: 220, height: 40 });

    jobs.click();
    expect(filterChanges).toHaveBeenCalledWith("jobs");
  });

  it("standalone button finalRect is stable after replay", () => {
    const { document } = createTestDocument(`<main><button id="cta">Go</button></main>`);
    const button = document.querySelector("#cta") as HTMLButtonElement;
    layoutManagedElement(button, { x: 40, y: 40, width: 120, height: 36 });

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://example.com/",
    });

    const target = {
      nodeId: "cta",
      signature: {
        cssPath: "main button#cta",
        tagName: "button",
        idAttr: "cta",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 40, y: 40, width: 120, height: 36 },
      element: button,
    };

    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(40, 40);
    const moveOps = controller.endMove(200, 40);
    const savedFinalRect =
      moveOps[0]?.type === "move" ? moveOps[0].metadata?.finalRect : undefined;
    expect(savedFinalRect).toEqual({ x: 200, y: 40, width: 120, height: 36 });

    button.removeAttribute("style");
    button.removeAttribute("data-otf-managed");
    button.removeAttribute("data-otf-transform");
    button.removeAttribute(OTF_INTERACTION_FIXED_ATTR);
    layoutManagedElement(button, { x: 40, y: 40, width: 120, height: 36 });

    const replayCustomization = new PageCustomizationController(document);
    replayCustomization.getAdapter().replayOperations(moveOps);
    layoutManagedElement(button, { x: 40, y: 40, width: 120, height: 36 });

    expect(extractBoundingBox(button)).toEqual(savedFinalRect);
  });

  it("zIndex persists after refresh on moved standalone button", async () => {
    const { document } = createTestDocument(`<main><button id="cta">Go</button></main>`);
    const button = document.querySelector("#cta") as HTMLButtonElement;
    layoutManagedElement(button, { x: 40, y: 40, width: 120, height: 36 });

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://example.com/",
    });

    const target = {
      nodeId: "cta",
      signature: {
        cssPath: "main button#cta",
        tagName: "button",
        idAttr: "cta",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 40, y: 40, width: 120, height: 36 },
      element: button,
    };

    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(40, 40);
    const moveOps = controller.endMove(200, 40);
    const layerOps = controller.applyLayerCommand("front");
    expect(button.style.zIndex).toBe(String(FRONT_LAYER));

    const savedOps = [...moveOps, ...layerOps];
    pageCustomization.setPageOperations(savedOps);
    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue(savedOps);

    button.removeAttribute("style");
    button.removeAttribute("data-otf-managed");
    button.removeAttribute("data-otf-transform");
    button.removeAttribute(OTF_INTERACTION_FIXED_ATTR);
    layoutManagedElement(button, { x: 40, y: 40, width: 120, height: 36 });

    const afterRefresh = new PageCustomizationController(document);
    await afterRefresh.ensureReplayed();

    expect(button.style.zIndex).toBe(String(FRONT_LAYER));
  });
});
