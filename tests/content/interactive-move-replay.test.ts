import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditSession } from "../../src/content/edit-session.js";
import { createTestPageCustomization } from "./edit-session-test-helpers.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { createTransformController } from "../../src/content/transform-controller.js";
import { DomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { layoutElement, layoutManagedElement } from "../editor/measurement/layout-helpers.js";

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

describe("interactive move replay and interact mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moved button still fires click after replay", () => {
    const { document, root } = createTestDocument(
      `<main><section class="card"><button id="cta">Continue</button></section></main>`,
    );
    const card = document.querySelector(".card") as HTMLElement;
    const button = document.querySelector("#cta") as HTMLButtonElement;
    layoutWithTransform(card, { x: 40, y: 40, width: 300, height: 160 });
    layoutWithTransform(button, { x: 50, y: 60, width: 160, height: 36 });

    const clickSpy = vi.fn();
    button.addEventListener("click", clickSpy);

    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const target = {
      nodeId: "cta",
      signature: {
        cssPath: "main section.card > button#cta",
        tagName: "button",
        idAttr: "cta",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 50, y: 60, width: 160, height: 36 },
      element: button,
    };

    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(50, 60);
    const moveOps = controller.endMove(320, 60);

    const replayAdapter = new DomRuntimeAdapter(root);
    replayAdapter.replayOperations(moveOps);

    const replayed = document.querySelector("#cta") as HTMLButtonElement;
    replayed.click();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(replayed.parentElement).toBe(card);
  });

  it("Interact mode allows clicking a moved interactive element", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><button id="action">Save</button></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const button = doc.querySelector("#action") as HTMLButtonElement;
    layoutElement(main, { x: 0, y: 0, width: 400, height: 200 });
    layoutWithTransform(button, { x: 20, y: 20, width: 120, height: 36 });

    const pageClick = vi.fn();
    button.addEventListener("click", pageClick);

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
      getPageKey: () => "https://example.com/",
    });

    const target = {
      nodeId: "action",
      signature: {
        cssPath: "main > button#action",
        tagName: "button",
        idAttr: "action",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 20, y: 20, width: 120, height: 36 },
      element: button,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(20, 20);
    controller.endMove(180, 20);

    win.dispatchEvent(
      new win.KeyboardEvent("keydown", {
        key: "i",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(session.isInteractMode()).toBe(true);

    const clickEvent = new win.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    button.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(false);
    expect(pageClick).toHaveBeenCalledTimes(1);

    session.stop();
    shell.unmount();
  });
});
