import { afterEach, describe, expect, it, vi } from "vitest";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { createTransformController } from "../../src/content/transform-controller.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { appendDraftOperations, createSessionOperationState } from "../../src/content/session-operation-state.js";
import { createEditSession } from "../../src/content/edit-session.js";
import { createTestPageCustomization } from "./edit-session-test-helpers.js";
import { extractBoundingBox } from "../../src/editor/measurement/bounding-box.js";
import { FRONT_LAYER } from "../../src/editor/transform/layer-order.js";
import { OTF_INTERACTION_FIXED_ATTR, OTF_TRANSFORM_ONLY_ATTR } from "../../src/editor/dom/types.js";
import {
  findInteractiveGroupContainer,
  isInteractiveOrContainsInteractive,
  requiresInteractionSafeFixedMove,
} from "../../src/editor/dom/interactive-safety.js";
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

function createNotificationsFixture(document: Document) {
  document.body.innerHTML = `
    <main id="app-root">
      <div role="tablist" class="filter-bar">
        <button role="tab" data-filter="all" aria-selected="true">All</button>
        <button role="tab" data-filter="jobs">Jobs</button>
        <button role="tab" data-filter="posts">My posts</button>
        <button role="tab" data-filter="mentions">Mentions</button>
      </div>
    </main>
  `;
  const appRoot = document.querySelector("#app-root") as HTMLElement;
  const tablist = document.querySelector(".filter-bar") as HTMLElement;
  const jobs = document.querySelector('[data-filter="jobs"]') as HTMLButtonElement;
  layoutElement(appRoot, { x: 0, y: 0, width: 900, height: 700 });
  layoutElement(tablist, { x: 40, y: 120, width: 420, height: 40 });
  layoutManagedElement(jobs, { x: 120, y: 120, width: 72, height: 32 });

  const filterChanges = vi.fn();
  tablist.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.dataset.filter) {
      filterChanges(target.dataset.filter);
    }
  });

  return { appRoot, tablist, jobs, filterChanges };
}

describe("phase 10 layering and SPA control regressions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects aria-checked and aria-selected controls as interactive", () => {
    const { root } = createTestDocument(`
      <main>
        <div role="radio" aria-checked="false">Jobs</div>
        <div role="tab" aria-selected="false">All</div>
      </main>
    `);
    expect(isInteractiveOrContainsInteractive(root.querySelector('[role="radio"]') as HTMLElement)).toBe(
      true,
    );
    expect(isInteractiveOrContainsInteractive(root.querySelector('[role="tab"]') as HTMLElement)).toBe(true);
  });

  it("promotes chip selection to tablist container for movement", () => {
    const { document } = createTestDocument("");
    const { jobs, tablist } = createNotificationsFixture(document);
    expect(findInteractiveGroupContainer(jobs)).toBe(tablist);
    expect(requiresInteractionSafeFixedMove(jobs)).toBe(false);
    expect(requiresInteractionSafeFixedMove(tablist)).toBe(false);
  });

  it("zIndex/bring-forward applies immediately in edit mode", () => {
    const { document } = createTestDocument(`<main><div class="box">A</div></main>`);
    const box = document.querySelector(".box") as HTMLElement;
    layoutElement(box, { x: 20, y: 20, width: 100, height: 40 });

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
          nodeId: "box",
          signature: {
            cssPath: "main div.box",
            tagName: "div",
            classList: ["box"],
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

    controller.applyLayerCommand("forward");
    expect(Number.parseInt(box.style.zIndex, 10)).toBeGreaterThan(1);
  });

  it("zIndex operation is added to dirty/session operations", () => {
    const { document } = createTestDocument(`<main><div class="box">A</div></main>`);
    const box = document.querySelector(".box") as HTMLElement;
    layoutElement(box, { x: 20, y: 20, width: 100, height: 40 });
    let state = createSessionOperationState([]);

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://example.com/",
      onApply: (operations) => {
        state = appendDraftOperations(state, operations);
      },
    });

    const target = {
      nodeId: "box",
      signature: {
        cssPath: "main div.box",
        tagName: "div",
        classList: ["box"],
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

    expect(state.draftOperations.some((operation) => operation.type === "zIndex")).toBe(true);
  });

  it("moved tablist uses transform-only and keeps filter chips clickable after replay", () => {
    const { document } = createTestDocument("");
    const { tablist, jobs, filterChanges } = createNotificationsFixture(document);

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://example.com/notifications",
    });

    const target = {
      nodeId: "jobs-tab",
      signature: {
        cssPath: 'main#app-root div.filter-bar > button[data-filter="jobs"]',
        tagName: "button",
        classList: [],
        role: "tab",
        textFingerprint: "Jobs",
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 120, y: 120, width: 72, height: 32 },
      element: jobs,
    };

    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(120, 120);
    const moveOps = controller.endMove(320, 120);

    expect(tablist.getAttribute(OTF_TRANSFORM_ONLY_ATTR)).toBe("true");
    expect(tablist.getAttribute(OTF_INTERACTION_FIXED_ATTR)).not.toBe("true");
    expect(jobs.parentElement).toBe(tablist);

    tablist.removeAttribute("style");
    tablist.removeAttribute("data-otf-managed");
    tablist.removeAttribute("data-otf-transform");
    tablist.removeAttribute(OTF_TRANSFORM_ONLY_ATTR);
    layoutElement(tablist, { x: 40, y: 120, width: 420, height: 40 });
    layoutManagedElement(jobs, { x: 120, y: 120, width: 72, height: 32 });

    const replayCustomization = new PageCustomizationController(document);
    replayCustomization.getAdapter().replayOperations(moveOps);
    layoutManagedElement(tablist, { x: 40, y: 120, width: 420, height: 40 });

    jobs.click();
    expect(filterChanges).toHaveBeenCalledWith("jobs");
  });

  it("moved element can be dragged again after first move", () => {
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
    controller.endMove(200, 40);

    layoutManagedElement(button, { x: 40, y: 40, width: 120, height: 36 });
    controller.beginMove(200, 40);
    controller.endMove(320, 120);

    layoutManagedElement(button, { x: 40, y: 40, width: 120, height: 36 });
    expect(extractBoundingBox(button)).toEqual({ x: 320, y: 120, width: 120, height: 36 });
  });

  it("refresh/replay restores saved zIndex on moved interactive element", async () => {
    const { document } = createTestDocument("");
    const { tablist } = createNotificationsFixture(document);

    const pageCustomization = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://example.com/notifications",
    });

    const target = {
      nodeId: "tablist",
      signature: {
        cssPath: "main#app-root div.filter-bar",
        tagName: "div",
        classList: ["filter-bar"],
        role: "tablist",
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 40, y: 120, width: 420, height: 40 },
      element: tablist,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(40, 120);
    const moveOps = controller.endMove(40, 220);
    const layerOps = controller.applyLayerCommand("front");
    const savedOps = [...moveOps, ...layerOps];
    pageCustomization.setPageOperations(savedOps);

    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue(savedOps);

    tablist.removeAttribute("style");
    tablist.removeAttribute("data-otf-managed");
    tablist.removeAttribute("data-otf-transform");
    layoutElement(tablist, { x: 40, y: 120, width: 420, height: 40 });

    const afterRefresh = new PageCustomizationController(document);
    await afterRefresh.ensureReplayed();

    expect(tablist.style.zIndex).toBe(String(FRONT_LAYER));
    expect(tablist.getAttribute(OTF_INTERACTION_FIXED_ATTR)).not.toBe("true");
  });

  it("Interact mode passes clicks through to moved filter chips", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `
      <main id="app-root">
        <div role="tablist" class="filter-bar">
          <button role="tab" data-filter="jobs">Jobs</button>
        </div>
      </main>
    `;
    const tablist = doc.querySelector(".filter-bar") as HTMLElement;
    const jobs = doc.querySelector('[data-filter="jobs"]') as HTMLButtonElement;
    layoutElement(tablist, { x: 40, y: 120, width: 160, height: 40 });
    layoutManagedElement(jobs, { x: 40, y: 120, width: 72, height: 32 });

    const filterChanges = vi.fn();
    tablist.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.dataset.filter) {
        filterChanges(target.dataset.filter);
      }
    });

    const pageCustomization = createTestPageCustomization(doc);
    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization,
    });
    await session.start();

    const controller = createTransformController({
      shell,
      document: doc,
      adapter: pageCustomization.getAdapter(),
      getPageKey: () => "https://example.com/notifications",
    });
    const target = {
      nodeId: "jobs-tab",
      signature: {
        cssPath: 'main#app-root div.filter-bar > button[data-filter="jobs"]',
        tagName: "button",
        classList: [],
        role: "tab",
        textFingerprint: "Jobs",
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 40, y: 120, width: 72, height: 32 },
      element: jobs,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(40, 120);
    controller.endMove(220, 120);

    win.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: "i",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(session.isInteractMode()).toBe(true);

    jobs.click();
    expect(filterChanges).toHaveBeenCalledWith("jobs");

    session.stop();
    shell.unmount();
  });
});
