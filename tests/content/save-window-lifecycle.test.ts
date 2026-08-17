import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditSession } from "../../src/content/edit-session.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { SaveWindowController } from "../../src/content/save-window-controller.js";
import { createDomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";
import { createSessionHistory } from "../../src/content/session-history.js";
import { createSessionOperationState } from "../../src/content/session-operation-state.js";
import { createStyleOperation } from "../editor/fixtures.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";
import * as storageClient from "../../src/content/storage-client.js";

function pointerEvent(
  type: string,
  init: { clientX: number; clientY: number; buttons?: number },
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    button: 0,
    buttons: init.buttons ?? 0,
    pointerId: 1,
    clientX: init.clientX,
    clientY: init.clientY,
  });
}

function driveSaveWindowDraw(
  controller: SaveWindowController,
  start: { x: number; y: number },
  end: { x: number; y: number },
): void {
  controller.handlePointerDown(pointerEvent("pointerdown", { clientX: start.x, clientY: start.y, buttons: 1 }));
  controller.handlePointerMove(pointerEvent("pointermove", { clientX: end.x, clientY: end.y, buttons: 1 }));
  controller.handlePointerUp(pointerEvent("pointerup", { clientX: end.x, clientY: end.y, buttons: 0 }));
}

describe("save window lifecycle", () => {
  afterEach(() => {
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
    vi.restoreAllMocks();
  });

  it("draws a save window and shows confirmation summary for draft ops", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><p id="left">Left</p><p id="right">Right</p></main>`;
    const left = doc.querySelector("#left") as HTMLElement;
    const right = doc.querySelector("#right") as HTMLElement;
    layoutElement(left, { x: 10, y: 10, width: 80, height: 24 });
    layoutElement(right, { x: 260, y: 10, width: 80, height: 24 });
    doc.elementsFromPoint = () => [left, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const pageCustomization = new PageCustomizationController(doc);
    const session = createEditSession({ shell, root: doc, pageCustomization });
    await session.start();

    dispatchPointer(win, left, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, left, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");

    dispatchPointer(win, right, "pointerdown", { clientX: 265, clientY: 15, buttons: 1 });
    dispatchPointer(win, right, "pointerup", { clientX: 265, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(0, 0, 255)");

    expect(session.startSaveWindow()).toBe(true);
    expect(session.isSaveWindowActive()).toBe(true);

    const controller = (session as unknown as { saveWindowController: SaveWindowController }).saveWindowController;
    driveSaveWindowDraw(controller, { x: 0, y: 0 }, { x: 180, y: 120 });

    const shadow = shell.getShadowRoot();
    expect(shadow?.querySelector(".otf-save-window")).not.toBeNull();
    expect(shadow?.querySelector(".otf-save-window-panel")).not.toBeNull();
    expect(shadow?.textContent).toContain("Kept");

    session.stop();
    shell.unmount();
  });

  it("confirm reverts outside draft operations and persists kept drafts", async () => {
    const { document, root } = createTestDocument(`<main><p id="left">Left</p><p id="right">Right</p></main>`);
    const leftEl = root.querySelector("#left") as HTMLElement;
    const rightEl = root.querySelector("#right") as HTMLElement;
    layoutElement(leftEl, { x: 10, y: 10, width: 80, height: 24 });
    layoutElement(rightEl, { x: 260, y: 10, width: 80, height: 24 });

    const left = createStyleOperation({
      id: "left-op",
      status: "draft",
      target: {
        nodeId: "left",
        signature: {
          cssPath: "main p#left",
          tagName: "p",
          classList: [],
          idAttr: "left",
          boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
        },
      },
      metadata: { affectedRect: { x: 10, y: 10, width: 80, height: 24 } },
    });
    const right = createStyleOperation({
      id: "right-op",
      status: "draft",
      target: {
        nodeId: "right",
        signature: {
          cssPath: "main p#right",
          tagName: "p",
          classList: [],
          idAttr: "right",
          boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
        },
      },
      metadata: { affectedRect: { x: 260, y: 10, width: 80, height: 24 } },
    });

    const adapter = createDomRuntimeAdapter(document);
    adapter.applyOperation(left);
    adapter.applyOperation(right);
    expect(leftEl.style.color).toBeTruthy();
    expect(rightEl.style.color).toBeTruthy();

    const replaceSpy = vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({ ok: true });
    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });

    let operationState = createSessionOperationState([]);
    operationState = { ...operationState, draftOperations: [left, right] };
    const pageCustomization = new PageCustomizationController(document);

    const controller = new SaveWindowController({
      shell,
      root: document,
      adapter,
      getOperationState: () => operationState,
      setOperationState: (state) => {
        operationState = state;
        pageCustomization.setPageOperations(state.savedOperations);
      },
      syncSavedOperationsToStorage: async () => {
        return pageCustomization.syncOperationsToStorage();
      },
      getSessionHistory: () => createSessionHistory(),
      setSessionHistory: () => undefined,
    });

    controller.start();
    driveSaveWindowDraw(controller, { x: 0, y: 0 }, { x: 180, y: 120 });

    await controller.confirm();

    expect(pageCustomization.getPageOperations().map((op) => op.id)).toEqual(["left-op"]);
    expect(rightEl.style.color).toBe("");
    expect(operationState.draftOperations).toHaveLength(0);
    expect(replaceSpy).toHaveBeenCalled();

    shell.unmount();
  });

  it("cancel changes nothing", () => {
    const { document } = createTestDocument(`<main><p id="x">X</p></main>`);
    const operation = createStyleOperation({
      status: "draft",
      metadata: { affectedRect: { x: 10, y: 10, width: 80, height: 24 } },
    });
    const adapter = createDomRuntimeAdapter(document);
    adapter.applyOperation(operation);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });

    let operationState = createSessionOperationState([]);
    operationState = { ...operationState, draftOperations: [operation] };

    const controller = new SaveWindowController({
      shell,
      root: document,
      adapter,
      getOperationState: () => operationState,
      setOperationState: (state) => {
        operationState = state;
      },
      syncSavedOperationsToStorage: () => Promise.resolve({ ok: true }),
      getSessionHistory: () => createSessionHistory(),
      setSessionHistory: () => undefined,
    });

    controller.start();
    driveSaveWindowDraw(controller, { x: 0, y: 0 }, { x: 180, y: 120 });
    controller.cancel();

    expect(operationState.draftOperations).toHaveLength(1);
    expect(controller.isActive()).toBe(false);
    shell.unmount();
  });

  it("ignores the S shortcut while typing in a page input", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><input class="name" value="Ada" /><p id="copy">Hello</p></main>`;
    const input = doc.querySelector("input") as HTMLInputElement;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(input, { x: 10, y: 10, width: 120, height: 24 });
    layoutElement(copy, { x: 10, y: 50, width: 120, height: 24 });
    doc.elementsFromPoint = () => [copy, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const pageCustomization = new PageCustomizationController(doc);
    const session = createEditSession({ shell, root: doc, pageCustomization });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 15, clientY: 55, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 15, clientY: 55, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");

    input.focus();
    win.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }),
    );

    expect(session.isSaveWindowActive()).toBe(false);
    expect(session.hasUnsavedChanges()).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("starts save window with plain S", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });
    doc.elementsFromPoint = () => [copy, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({ shell, root: doc, pageCustomization: new PageCustomizationController(doc) });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");

    win.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(session.isSaveWindowActive()).toBe(true);

    session.stop();
    shell.unmount();
  });
});

function dispatchPointer(
  win: typeof globalThis,
  target: EventTarget,
  type: string,
  init: { clientX: number; clientY: number; buttons?: number },
): void {
  target.dispatchEvent(
    new win.PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      button: 0,
      buttons: init.buttons ?? 0,
      pointerId: 1,
      clientX: init.clientX,
      clientY: init.clientY,
    }),
  );
}
