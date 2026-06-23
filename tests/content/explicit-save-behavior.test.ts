import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPreviewController } from "../../src/content/agent/agent-preview-controller.js";
import { createEditSession, type EditSession } from "../../src/content/edit-session.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { SaveWindowController } from "../../src/content/save-window-controller.js";
import { createTestPageCustomization } from "./edit-session-test-helpers.js";
import { createDomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";
import {
  createSessionOperationState,
} from "../../src/content/session-operation-state.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";
import {
  createInsertHelperObjectOperation,
  createStyleOperation,
  createTestSignature,
  PAGE_KEY,
} from "../editor/fixtures.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import type { AgentContextInput } from "../../src/content/agent/context-builder.js";
import { VisualLayoutGraph } from "../../src/editor/visual-graph/visual-layout-graph.js";
import { OTF_HELPER_ATTR } from "../../src/editor/dom/types.js";
import { createSessionHistory } from "../../src/content/session-history.js";
import type { EditorOperation } from "../../src/editor/operations.js";
import * as storageClient from "../../src/content/storage-client.js";

const { sendAgentEditRequestMock } = vi.hoisted(() => ({
  sendAgentEditRequestMock: vi.fn(),
}));

vi.mock("../../src/content/agent/agent-client.js", () => ({
  sendAgentEditRequest: sendAgentEditRequestMock,
}));

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

function getSaveWindowController(session: EditSession): SaveWindowController {
  return (session as unknown as { saveWindowController: SaveWindowController }).saveWindowController;
}

function pressS(win: typeof globalThis): void {
  win.dispatchEvent(
    new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }),
  );
}

async function startSessionWithCopy(): Promise<{
  doc: Document;
  win: typeof globalThis;
  copy: HTMLElement;
  shell: EditorShell;
  session: EditSession;
  pageCustomization: PageCustomizationController;
}> {
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

  return { doc, win, copy, shell, session, pageCustomization };
}

async function replayAfterRefresh(
  doc: Document,
  copy: HTMLElement,
  persistedOps: EditorOperation[],
): Promise<void> {
  vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue(persistedOps);
  copy.style.removeProperty("color");
  const replayController = new PageCustomizationController(doc);
  await replayController.ensureReplayed();
}

describe("explicit save behavior", () => {
  afterEach(() => {
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
    vi.restoreAllMocks();
  });

  it("manual edit → press S only → refresh → edit is not persisted", async () => {
    const replaceSpy = vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({ ok: true });
    const { doc, win, copy, shell, session } = await startSessionWithCopy();

    session.applyStyle("color", "rgb(255, 0, 0)");
    pressS(win);

    expect(session.isSaveWindowActive()).toBe(true);
    expect(replaceSpy).not.toHaveBeenCalled();

    session.stop();
    shell.unmount();

    await replayAfterRefresh(doc, copy, []);
    expect(copy.style.color).toBe("");
  });

  it("manual edit → S + drag region containing target → refresh → edit persists", async () => {
    let persistedOps: EditorOperation[] = [];
    vi.spyOn(storageClient, "replacePageOperations").mockImplementation((_pageKey, operations) => {
      persistedOps = [...operations];
      return Promise.resolve({ ok: true });
    });

    const { doc, win, copy, shell, session } = await startSessionWithCopy();
    session.applyStyle("color", "rgb(255, 0, 0)");

    pressS(win);
    const controller = getSaveWindowController(session);
    driveSaveWindowDraw(controller, { x: 0, y: 0 }, { x: 180, y: 120 });
    await controller.confirm();

    session.stop();
    shell.unmount();

    await replayAfterRefresh(doc, copy, persistedOps);
    expect(copy.style.color).toBe("rgb(255, 0, 0)");
  });

  it("manual edit outside S-drag region → refresh → edit does not persist", async () => {
    let persistedOps: EditorOperation[] = [];
    vi.spyOn(storageClient, "replacePageOperations").mockImplementation((_pageKey, operations) => {
      persistedOps = [...operations];
      return Promise.resolve({ ok: true });
    });

    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><p id="far">Far</p></main>`;
    const far = doc.querySelector("#far") as HTMLElement;
    layoutElement(far, { x: 400, y: 10, width: 80, height: 24 });
    doc.elementsFromPoint = () => [far, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, far, "pointerdown", { clientX: 405, clientY: 15, buttons: 1 });
    dispatchPointer(win, far, "pointerup", { clientX: 405, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");

    pressS(win);
    const controller = getSaveWindowController(session);
    driveSaveWindowDraw(controller, { x: 0, y: 0 }, { x: 180, y: 120 });
    await controller.confirm();

    session.stop();
    shell.unmount();

    await replayAfterRefresh(doc, far, persistedOps);
    expect(far.style.color).toBe("");
    expect(persistedOps).toEqual([]);
  });

  it("multiple dirty edits → S + drag region → only intersecting edits persist", async () => {
    let persistedOps: EditorOperation[] = [];
    vi.spyOn(storageClient, "replacePageOperations").mockImplementation((_pageKey, operations) => {
      persistedOps = [...operations];
      return Promise.resolve({ ok: true });
    });

    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><p id="left">Left</p><p id="right">Right</p></main>`;
    const left = doc.querySelector("#left") as HTMLElement;
    const right = doc.querySelector("#right") as HTMLElement;
    layoutElement(left, { x: 10, y: 10, width: 80, height: 24 });
    layoutElement(right, { x: 260, y: 10, width: 80, height: 24 });
    doc.elementsFromPoint = (x: number) => {
      if (x < 200) {
        return [left, doc.body, doc.documentElement];
      }
      return [right, doc.body, doc.documentElement];
    };

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, left, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, left, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");

    dispatchPointer(win, right, "pointerdown", { clientX: 265, clientY: 15, buttons: 1 });
    dispatchPointer(win, right, "pointerup", { clientX: 265, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(0, 0, 255)");

    pressS(win);
    const controller = getSaveWindowController(session);
    driveSaveWindowDraw(controller, { x: 0, y: 0 }, { x: 180, y: 120 });
    await controller.confirm();

    session.stop();
    shell.unmount();

    await replayAfterRefresh(doc, left, persistedOps);
    expect(left.style.color).toBe("rgb(255, 0, 0)");
    expect(right.style.color).toBe("");
    expect(persistedOps).toHaveLength(1);
  });

  it("agent approve → S + drag containing helper → refresh → region edit persists", async () => {
    sendAgentEditRequestMock.mockReset();
    let persistedOps: EditorOperation[] = [];
    vi.spyOn(storageClient, "replacePageOperations").mockImplementation((_pageKey, operations) => {
      persistedOps = [...operations];
      return Promise.resolve({ ok: true });
    });

    const { document, root } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const copy = root.querySelector("#copy") as HTMLElement;
    const adapter = createDomRuntimeAdapter(document);
    let operationState = createSessionOperationState([]);

    const helperOp = {
      ...createInsertHelperObjectOperation({
        id: "agent-helper",
        source: "agent",
        status: "preview",
        payload: {
          ...createInsertHelperObjectOperation().payload,
          helperId: "agent-helper-panel",
          rect: { x: 10, y: 40, width: 140, height: 80 },
          zIndex: 1,
        },
      }),
      metadata: { affectedRect: { x: 10, y: 40, width: 140, height: 80 } },
    };

    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: {
        draftOperations: [helperOp],
        summary: ["Added panel"],
        warnings: [],
        confidence: "high",
      },
    });

    const contextInput: AgentContextInput = {
      pageKey: PAGE_KEY,
      instruction: "Add panel",
      selection: { selectedNodeIds: ["node-1"], source: "click" },
      selectedNodes: [
        {
          id: "node-1",
          kind: "text",
          signature: createTestSignature({ cssPath: "main p#copy", tagName: "p", idAttr: "copy" }),
          rect: { x: 10, y: 10, width: 100, height: 24 },
          computed: {},
          childIds: [],
          element: copy,
        },
      ],
      graph: new VisualLayoutGraph({
        nodes: new Map(),
        rootNodeIds: [],
        viewport: { width: 1280, height: 720 },
        builtAt: 1,
        version: 1,
      }),
      existingOperations: [],
    };

    const previewController = new AgentPreviewController({
      adapter,
      getContextInput: () => contextInput,
      getOperationState: () => operationState,
      setOperationState: (state) => {
        operationState = state;
      },
    });

    await previewController.requestPreview("Add panel");
    expect(previewController.approvePreview()).toBe(true);
    expect(operationState.draftOperations.length).toBeGreaterThan(0);
    expect(document.querySelector(`[${OTF_HELPER_ATTR}]`)).not.toBeNull();

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const pageCustomization = new PageCustomizationController(document);
    pageCustomization.setPageOperations([]);

    const saveWindow = new SaveWindowController({
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

    expect(saveWindow.start()).toBe(true);
    driveSaveWindowDraw(saveWindow, { x: 0, y: 0 }, { x: 200, y: 160 });
    expect(await saveWindow.confirm()).toBe(true);
    expect(persistedOps.length).toBe(1);
    adapter.clearAppliedEffects();
    document.querySelector(`[${OTF_HELPER_ATTR}]`)?.remove();

    adapter.replayOperations(persistedOps);
    expect(document.querySelector(`[${OTF_HELPER_ATTR}]`)).not.toBeNull();
    shell.unmount();
  });

  it("agent approve → refresh without save → does not persist", async () => {
    sendAgentEditRequestMock.mockReset();
    const { document, root } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const copy = root.querySelector("#copy") as HTMLElement;
    const adapter = createDomRuntimeAdapter(document);
    let operationState = createSessionOperationState([
      createStyleOperation({ id: "saved-1", status: "approved" }),
    ]);

    const helperOp = createInsertHelperObjectOperation({
      id: "agent-helper",
      source: "agent",
      status: "preview",
    });

    sendAgentEditRequestMock.mockResolvedValue({
      ok: true,
      response: {
        draftOperations: [helperOp],
        summary: ["Added panel"],
        warnings: [],
        confidence: "high",
      },
    });

    const previewController = new AgentPreviewController({
      adapter,
      getContextInput: () => ({
        pageKey: PAGE_KEY,
        instruction: "Add panel",
        selection: { selectedNodeIds: ["node-1"], source: "click" },
        selectedNodes: [
          {
            id: "node-1",
            kind: "text",
            signature: createTestSignature({ cssPath: "main p#copy", tagName: "p", idAttr: "copy" }),
            rect: { x: 10, y: 10, width: 100, height: 24 },
            computed: {},
            childIds: [],
            element: copy,
          },
        ],
        graph: new VisualLayoutGraph({
          nodes: new Map(),
          rootNodeIds: [],
          viewport: { width: 1280, height: 720 },
          builtAt: 1,
          version: 1,
        }),
        existingOperations: operationState.savedOperations,
      }),
      getOperationState: () => operationState,
      setOperationState: (state) => {
        operationState = state;
      },
    });

    await previewController.requestPreview("Add panel");
    previewController.approvePreview();
    expect(document.querySelector(`[${OTF_HELPER_ATTR}]`)).not.toBeNull();

    adapter.clearAppliedEffects();
    document.querySelector(`[${OTF_HELPER_ATTR}]`)?.remove();

    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue(operationState.savedOperations);
    const replayController = new PageCustomizationController(document);
    await replayController.ensureReplayed();

    expect(document.querySelector(`[${OTF_HELPER_ATTR}]`)).toBeNull();
  });

  it("Save button saves all dirty session operations", async () => {
    let persistedOps: EditorOperation[] = [];
    vi.spyOn(storageClient, "replacePageOperations").mockImplementation((_pageKey, operations) => {
      persistedOps = [...operations];
      return Promise.resolve({ ok: true });
    });

    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><p id="left">Left</p><p id="right">Right</p></main>`;
    const left = doc.querySelector("#left") as HTMLElement;
    const right = doc.querySelector("#right") as HTMLElement;
    layoutElement(left, { x: 10, y: 10, width: 80, height: 24 });
    layoutElement(right, { x: 260, y: 10, width: 80, height: 24 });
    doc.elementsFromPoint = (x: number) =>
      x < 200 ? [left, doc.body, doc.documentElement] : [right, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, left, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, left, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");

    dispatchPointer(win, right, "pointerdown", { clientX: 265, clientY: 15, buttons: 1 });
    dispatchPointer(win, right, "pointerup", { clientX: 265, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(0, 0, 255)");

    await session.saveAll();
    expect(persistedOps).toHaveLength(2);

    session.stop();
    shell.unmount();

    left.style.removeProperty("color");
    right.style.removeProperty("color");
    await replayAfterRefresh(doc, left, persistedOps);
    expect(left.style.color).toBe("rgb(255, 0, 0)");
    expect(right.style.color).toBe("rgb(0, 0, 255)");
  });

  it("plain S never saves the whole page", async () => {
    const replaceSpy = vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({ ok: true });
    const { win, shell, session } = await startSessionWithCopy();

    session.applyStyle("color", "rgb(255, 0, 0)");
    pressS(win);

    expect(session.isSaveWindowActive()).toBe(true);
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(session.hasUnsavedChanges()).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("Ctrl/Cmd+S does not save all dirty operations", async () => {
    const replaceSpy = vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({ ok: true });
    const { win, shell, session } = await startSessionWithCopy();

    session.applyStyle("color", "rgb(255, 0, 0)");
    win.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(replaceSpy).not.toHaveBeenCalled();
    expect(session.isSaveWindowActive()).toBe(false);
    expect(session.hasUnsavedChanges()).toBe(true);

    session.stop();
    shell.unmount();
  });
});
