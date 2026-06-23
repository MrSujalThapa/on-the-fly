import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditSession } from "../../src/content/edit-session.js";
import { createTestPageCustomization } from "./edit-session-test-helpers.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { SaveWindowController } from "../../src/content/save-window-controller.js";
import { createDomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";
import { createSessionOperationState } from "../../src/content/session-operation-state.js";
import { createSessionHistory } from "../../src/content/session-history.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";
import { createStyleOperation } from "../editor/fixtures.js";
import type { EditorOperation } from "../../src/editor/operations.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import * as storageClient from "../../src/content/storage-client.js";

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

function driveSaveWindowDraw(
  controller: SaveWindowController,
  start: { x: number; y: number },
  end: { x: number; y: number },
): void {
  controller.handlePointerDown(
    new PointerEvent("pointerdown", {
      bubbles: true,
      clientX: start.x,
      clientY: start.y,
      button: 0,
      buttons: 1,
      pointerId: 1,
    }),
  );
  controller.handlePointerMove(
    new PointerEvent("pointermove", {
      bubbles: true,
      clientX: end.x,
      clientY: end.y,
      button: 0,
      buttons: 1,
      pointerId: 1,
    }),
  );
  controller.handlePointerUp(
    new PointerEvent("pointerup", {
      bubbles: true,
      clientX: end.x,
      clientY: end.y,
      button: 0,
      buttons: 0,
      pointerId: 1,
    }),
  );
}

describe("draft persistence", () => {
  afterEach(() => {
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
    vi.restoreAllMocks();
  });

  it("does not auto-save normal edits", async () => {
    const saveSpy = vi.spyOn(storageClient, "savePageOperations").mockResolvedValue({ ok: true });
    const replaceSpy = vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({ ok: true });

    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });
    doc.elementsFromPoint = () => [copy, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({ shell, root: doc, pageCustomization: createTestPageCustomization(doc) });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");

    expect(saveSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(session.hasUnsavedChanges()).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("shows the save button when draft changes exist", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });
    doc.elementsFromPoint = () => [copy, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({ shell, root: doc, pageCustomization: createTestPageCustomization(doc) });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");

    const saveButton = shell.getShadowRoot()?.querySelector(".otf-save-button") as HTMLButtonElement;
    expect(saveButton.hidden).toBe(false);
    expect(saveButton.textContent).toContain("Save all");

    session.stop();
    shell.unmount();
  });

  it("loses manual edits on refresh simulation without save", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });
    doc.elementsFromPoint = () => [copy, doc.body, doc.documentElement];

    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue([]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const pageCustomization = createTestPageCustomization(doc);
    const session = createEditSession({ shell, root: doc, pageCustomization });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");
    expect(copy.style.color).toBe("rgb(255, 0, 0)");
    expect(session.hasUnsavedChanges()).toBe(true);

    session.stop();
    shell.unmount();

    copy.style.removeProperty("color");
    await pageCustomization.ensureReplayed();

    expect(copy.style.color).toBe("");
  });

  it("replays manual edits after save and refresh simulation", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });
    doc.elementsFromPoint = () => [copy, doc.body, doc.documentElement];

    let persistedOps: EditorOperation[] = [];
    vi.spyOn(storageClient, "replacePageOperations").mockImplementation((_pageKey, operations) => {
      persistedOps = [...operations];
      return Promise.resolve({ ok: true });
    });
    vi.spyOn(storageClient, "loadPageOperations").mockImplementation((): Promise<EditorOperation[]> =>
      Promise.resolve(persistedOps),
    );

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const pageCustomization = createTestPageCustomization(doc);
    const session = createEditSession({ shell, root: doc, pageCustomization });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(0, 128, 0)");
    await session.saveAll();

    session.stop();
    shell.unmount();

    copy.style.removeProperty("color");
    const replayController = new PageCustomizationController(doc);
    await replayController.ensureReplayed();

    expect(copy.style.color).toBe("rgb(0, 128, 0)");
  });

  it("persists draft operations on explicit save", async () => {
    const replaceSpy = vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({ ok: true });

    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });
    doc.elementsFromPoint = () => [copy, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const pageCustomization = createTestPageCustomization(doc);
    const session = createEditSession({ shell, root: doc, pageCustomization });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");

    await session.saveAll();

    expect(replaceSpy).toHaveBeenCalled();
    expect(pageCustomization.getPageOperations().length).toBeGreaterThan(0);
    expect(session.hasUnsavedChanges()).toBe(false);

    const saveButton = shell.getShadowRoot()?.querySelector(".otf-save-button") as HTMLButtonElement;
    expect(saveButton.hidden).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("replays saved operations after refresh without draft ops", async () => {
    const { document, root } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const copy = root.querySelector("#copy") as HTMLElement;
    const operation = createStyleOperation({
      target: {
        nodeId: "node-1",
        signature: {
          cssPath: "main p#copy",
          tagName: "p",
          classList: [],
          idAttr: "copy",
          boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
        },
      },
      payload: { property: "color", value: "rgb(0, 128, 0)" },
    });

    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue([operation]);

    const controller = new PageCustomizationController(document);
    await controller.ensureReplayed();

    expect(copy.style.color).toBe("rgb(0, 128, 0)");
  });

  it("undo restores hide and clears dirty state without touching storage", async () => {
    const replaceSpy = vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({ ok: true });
    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });
    doc.elementsFromPoint = () => [copy, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({ shell, root: doc, pageCustomization: createTestPageCustomization(doc) });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.hideSelection();

    expect(copy.style.display).toBe("none");
    expect(session.hasUnsavedChanges()).toBe(true);

    expect(session.undo()).toBe(true);
    expect(copy.style.display).not.toBe("none");
    expect(session.hasUnsavedChanges()).toBe(false);
    expect(replaceSpy).not.toHaveBeenCalled();

    session.stop();
    shell.unmount();
  });

  it("redo reapplies draft hide", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });
    doc.elementsFromPoint = () => [copy, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({ shell, root: doc, pageCustomization: createTestPageCustomization(doc) });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.hideSelection();
    session.undo();
    session.redo();

    expect(copy.style.display).toBe("none");
    expect(session.hasUnsavedChanges()).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("clear page reverts saved and draft changes immediately", async () => {
    const { document, root } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const copy = root.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });

    vi.spyOn(storageClient, "clearPageOperations").mockResolvedValue(true);

    const pageCustomization = new PageCustomizationController(document);
    const saved = createStyleOperation({
      target: {
        nodeId: "node-1",
        signature: {
          cssPath: "main p#copy",
          tagName: "p",
          classList: [],
          idAttr: "copy",
          boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
        },
      },
      payload: { property: "color", value: "rgb(0, 128, 0)" },
    });
    pageCustomization.getAdapter().applyOperation(saved);
    pageCustomization.setPageOperations([saved]);
    expect(copy.style.color).toBe("rgb(0, 128, 0)");

    await pageCustomization.clearPage();
    expect(copy.style.color).toBe("");
    expect(pageCustomization.getPageOperations()).toEqual([]);
  });

  it("save window classifies draft ops only and keeps inside region", async () => {
    const { document, root } = createTestDocument(`<main><p id="left">Left</p><p id="right">Right</p></main>`);
    const leftEl = root.querySelector("#left") as HTMLElement;
    const rightEl = root.querySelector("#right") as HTMLElement;
    layoutElement(leftEl, { x: 10, y: 10, width: 80, height: 24 });
    layoutElement(rightEl, { x: 260, y: 10, width: 80, height: 24 });

    const saved = createStyleOperation({
      id: "saved-op",
      status: "approved",
      target: {
        nodeId: "saved",
        signature: {
          cssPath: "main p#saved",
          tagName: "p",
          classList: [],
          idAttr: "saved",
          boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
        },
      },
      metadata: { affectedRect: { x: 400, y: 10, width: 80, height: 24 } },
    });

    const leftDraft = createStyleOperation({
      id: "left-draft",
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
    const rightDraft = createStyleOperation({
      id: "right-draft",
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
    adapter.applyOperation(saved);
    adapter.applyOperation(leftDraft);
    adapter.applyOperation(rightDraft);
    expect(leftEl.style.color).toBeTruthy();
    expect(rightEl.style.color).toBeTruthy();

    const replaceSpy = vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({ ok: true });
    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });

    let operationState = createSessionOperationState([saved]);
    operationState = {
      ...operationState,
      draftOperations: [leftDraft, rightDraft],
    };

    const pageCustomization = new PageCustomizationController(document);
    pageCustomization.setPageOperations([saved]);

    const controller = new SaveWindowController({
      shell,
      root: document,
      adapter,
      getOperationState: () => operationState,
      setOperationState: (state) => {
        operationState = state;
        pageCustomization.setPageOperations(state.savedOperations);
      },
      syncSavedOperationsToStorage: () => pageCustomization.syncOperationsToStorage(),
      getSessionHistory: () => createSessionHistory(),
      setSessionHistory: () => undefined,
    });

    controller.start();
    driveSaveWindowDraw(controller, { x: 0, y: 0 }, { x: 180, y: 120 });
    await controller.confirm();

    expect(pageCustomization.getPageOperations().map((op) => op.id)).toEqual(["saved-op", "left-draft"]);
    expect(rightEl.style.color).toBe("");
    expect(operationState.draftOperations).toHaveLength(0);
    expect(replaceSpy).toHaveBeenCalled();

    shell.unmount();
  });

  it("save window cancel changes nothing", () => {
    const { document } = createTestDocument(`<main><p id="x">X</p></main>`);
    const draft = createStyleOperation({
      id: "draft-1",
      status: "draft",
      metadata: { affectedRect: { x: 10, y: 10, width: 80, height: 24 } },
    });
    const adapter = createDomRuntimeAdapter(document);
    adapter.applyOperation(draft);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });

    let operationState = createSessionOperationState([]);
    operationState = { ...operationState, draftOperations: [draft] };

    const controller = new SaveWindowController({
      shell,
      root: document,
      adapter,
      getOperationState: () => operationState,
      setOperationState: (state) => {
        operationState = state;
      },
      syncSavedOperationsToStorage: () => Promise.resolve(),
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
});
