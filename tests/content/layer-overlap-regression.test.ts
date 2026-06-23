import { afterEach, describe, expect, it, vi } from "vitest";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { createTransformController } from "../../src/content/transform-controller.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { appendDraftOperations, createSessionOperationState } from "../../src/content/session-operation-state.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";
import * as storageClient from "../../src/content/storage-client.js";
import { FRONT_LAYER } from "../../src/editor/transform/layer-order.js";

function createFakeShell(): EditorShell {
  return {
    setHandlePointerDownHandler: () => undefined,
    clearOverlays: () => undefined,
    clearOverlayTranslate: () => undefined,
    translateOverlay: () => undefined,
    renderSelectionOutlines: () => undefined,
  } as unknown as EditorShell;
}

function createLinkedInFixture(document: Document) {
  document.body.innerHTML = `
    <div id="application-outlet">
      <header id="global-nav">Nav</header>
      <aside id="sidebar">
        <div class="profile-card">
          <a id="experience">Experience</a>
        </div>
      </aside>
    </div>
  `;
  const outlet = document.querySelector("#application-outlet") as HTMLElement;
  const navbar = document.querySelector("#global-nav") as HTMLElement;
  const sidebar = document.querySelector("#sidebar") as HTMLElement;
  const experience = document.querySelector("#experience") as HTMLElement;

  outlet.style.transform = "translate(0px)";
  navbar.style.position = "relative";
  navbar.style.zIndex = "100";
  layoutElement(outlet, { x: 0, y: 0, width: 900, height: 700 });
  layoutElement(navbar, { x: 0, y: 0, width: 900, height: 52 });
  layoutElement(sidebar, { x: 0, y: 80, width: 280, height: 420 });
  layoutElement(experience, { x: 20, y: 20, width: 160, height: 28 });

  if (typeof document.elementsFromPoint !== "function") {
    document.elementsFromPoint = () => [];
  }
  vi.spyOn(document, "elementsFromPoint").mockImplementation(() => [
    navbar,
    experience,
    sidebar,
    outlet,
    document.body,
    document.documentElement,
  ]);

  return { outlet, navbar, sidebar, experience };
}

describe("layer overlap regression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bring-forward on Experience over navbar lifts selected-side host live", () => {
    const { document } = createTestDocument("");
    const { navbar, sidebar, experience } = createLinkedInFixture(document);

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://www.linkedin.com/in/me/",
    });

    const target = {
      nodeId: "experience",
      signature: {
        cssPath: "div#application-outlet aside#sidebar a#experience",
        tagName: "a",
        idAttr: "experience",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 20, y: 20, width: 160, height: 28 },
      element: experience,
    };

    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });

    const layerOps = controller.applyLayerCommand("forward");
    expect(layerOps.length).toBe(1);

    expect(Number.parseInt(navbar.style.zIndex, 10)).toBe(100);
    expect(Number.parseInt(sidebar.style.zIndex, 10)).toBeGreaterThan(100);
    expect(experience.parentElement?.parentElement).toBe(sidebar);
  });

  it("records zIndex drafts and replays resolved host layer after refresh", async () => {
    const { document } = createTestDocument("");
    const { sidebar, experience } = createLinkedInFixture(document);
    let state = createSessionOperationState([]);

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://www.linkedin.com/in/me/",
      onApply: (operations) => {
        state = appendDraftOperations(state, operations);
      },
    });

    const target = {
      nodeId: "experience",
      signature: {
        cssPath: "div#application-outlet aside#sidebar a#experience",
        tagName: "a",
        idAttr: "experience",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 20, y: 120, width: 160, height: 28 },
      element: experience,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    const layerOps = controller.applyLayerCommand("front");
    expect(state.draftOperations.some((operation) => operation.type === "zIndex")).toBe(true);

    pageCustomization.setPageOperations(layerOps);
    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue(layerOps);

    sidebar.removeAttribute("style");
    experience.removeAttribute("style");

    const afterRefresh = new PageCustomizationController(document);
    await afterRefresh.ensureReplayed();

    expect(sidebar.style.zIndex).toBe(String(FRONT_LAYER));
  });

  it("clear page restores original inline z-index on resolved host", () => {
    const { document } = createTestDocument("");
    const { sidebar, experience } = createLinkedInFixture(document);

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://www.linkedin.com/in/me/",
    });

    const target = {
      nodeId: "experience",
      signature: {
        cssPath: "div#application-outlet aside#sidebar a#experience",
        tagName: "a",
        idAttr: "experience",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 20, y: 120, width: 160, height: 28 },
      element: experience,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.applyLayerCommand("forward");
    expect(sidebar.style.zIndex).not.toBe("");

    pageCustomization.getAdapter().clearAppliedEffects();
    expect(sidebar.style.zIndex).toBe("");
    expect(sidebar.style.position).toBe("");
  });
});
