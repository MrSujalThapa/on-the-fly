import { describe, expect, it, vi, afterEach } from "vitest";
import { createEditSession } from "../../src/content/edit-session.js";
import { createTestPageCustomization } from "./edit-session-test-helpers.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import { VisualLayoutGraph } from "../../src/editor/visual-graph/visual-layout-graph.js";
import type { VisualNode } from "../../src/editor/visual-node.js";

const localAgentAvailable = vi.hoisted(() => ({ value: true }));

vi.mock("../../src/shared/build-flags.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/shared/build-flags.js")>();
  return {
    ...actual,
    isLocalAgentAvailable: () => localAgentAvailable.value,
  };
});

function dispatchPointer(
  win: typeof globalThis,
  target: EventTarget,
  type: string,
  init: { clientX: number; clientY: number; buttons?: number; shiftKey?: boolean },
): void {
  const event = new win.PointerEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    button: 0,
    buttons: init.buttons ?? 0,
    pointerId: 1,
    clientX: init.clientX,
    clientY: init.clientY,
    shiftKey: init.shiftKey ?? false,
  });
  target.dispatchEvent(event);
}

function dispatchKey(
  win: typeof globalThis,
  target: EventTarget,
  key: string,
  init: KeyboardEventInit = {},
): void {
  target.dispatchEvent(new win.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

function createNode(overrides: Partial<VisualNode> & Pick<VisualNode, "id">): VisualNode {
  return {
    kind: "text",
    signature: {
      cssPath: `main p#${overrides.id}`,
      tagName: "p",
      idAttr: overrides.id,
      classList: [],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
    rect: { x: 20, y: 20, width: 160, height: 28 },
    computed: {},
    childIds: [],
    ...overrides,
  };
}

describe("EditSession phase 9C4 interactions", () => {
  afterEach(() => {
    localAgentAvailable.value = true;
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
    vi.restoreAllMocks();
  });

  it("does not hide the selection when Backspace is pressed inside the style panel", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(copy, { x: 20, y: 20, width: 160, height: 28 });
    doc.elementsFromPoint = vi.fn(() => [copy, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    (session as unknown as { toggleStylePanel: () => void }).toggleStylePanel();

    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }
    const fontSizeInput = shadow.querySelector('[data-style-field="fontSize"]') as HTMLInputElement;
    fontSizeInput.focus();

    dispatchKey(win, fontSizeInput, "Backspace");
    expect(copy.style.display).not.toBe("none");

    session.stop();
    shell.unmount();
  });

  it("keeps the reserved agent panel closed on normal double-click in local dev", async () => {
    localAgentAvailable.value = true;
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(copy, { x: 20, y: 20, width: 160, height: 28 });
    doc.elementsFromPoint = vi.fn(() => [copy, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });

    const shadow = shell.getShadowRoot();
    expect(shadow?.querySelector(".otf-agent-panel")).not.toBeNull();
    expect((shadow?.querySelector(".otf-agent-panel") as HTMLElement).hidden).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("does not open inline text editing on double-click", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(copy, { x: 20, y: 20, width: 160, height: 28 });
    doc.elementsFromPoint = vi.fn(() => [copy, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });

    const shadow = shell.getShadowRoot();
    expect(shadow?.querySelector(".otf-text-editor-input")).toBeNull();
    expect(copy.isContentEditable).toBe(false);

    session.stop();
    shell.unmount();
  });

  it("still opens the toolbar text editor from the text command", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(copy, { x: 20, y: 20, width: 160, height: 28 });
    doc.elementsFromPoint = vi.fn(() => [copy, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    dispatchKey(win, doc, "t");
    await nextFrame();

    const shadow = shell.getShadowRoot();
    (session as unknown as { openTextEditor: (x?: number, y?: number) => void }).openTextEditor(40, 30);
    expect(
      shadow?.querySelector(".otf-text-editor-input") ??
        copy.getAttribute("contenteditable"),
    ).toBeTruthy();

    session.stop();
    shell.unmount();
  });

  it("does not open the agent panel in public build mode", async () => {
    localAgentAvailable.value = false;
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(copy, { x: 20, y: 20, width: 160, height: 28 });
    doc.elementsFromPoint = vi.fn(() => [copy, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });

    const shadow = shell.getShadowRoot();
    const panel = shadow?.querySelector(".otf-agent-panel") as HTMLElement | null;
    expect(panel?.hidden ?? true).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("keeps the agent panel hidden when edit mode starts", async () => {
    const doc = globalThis.document;
    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    const panel = shell.getShadowRoot()?.querySelector(".otf-agent-panel") as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel?.hidden).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("closes the agent panel on Escape", async () => {
    localAgentAvailable.value = true;
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(copy, { x: 20, y: 20, width: 160, height: 28 });
    doc.elementsFromPoint = vi.fn(() => [copy, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });

    (session as unknown as { openAgentPanel: (x: number, y: number) => void }).openAgentPanel(40, 30);
    const panel = shell.getShadowRoot()?.querySelector(".otf-agent-panel") as HTMLElement;
    expect(panel.hidden).toBe(false);

    expect(session.handleEscape()).toBe(true);
    expect(panel.hidden).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("hides the agent panel when edit mode stops", async () => {
    localAgentAvailable.value = true;
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(copy, { x: 20, y: 20, width: 160, height: 28 });
    doc.elementsFromPoint = vi.fn(() => [copy, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });

    (session as unknown as { openAgentPanel: (x: number, y: number) => void }).openAgentPanel(40, 30);
    const panel = shell.getShadowRoot()?.querySelector(".otf-agent-panel") as HTMLElement;
    expect(panel.hidden).toBe(false);

    session.stop();
    expect(shell.getShadowRoot()?.querySelector(".otf-agent-panel")).toBeNull();
    shell.unmount();
  });

  it("hides the agent panel when reject is clicked", async () => {
    localAgentAvailable.value = true;
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(copy, { x: 20, y: 20, width: 160, height: 28 });
    doc.elementsFromPoint = vi.fn(() => [copy, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });

    (session as unknown as { openAgentPanel: (x: number, y: number) => void }).openAgentPanel(40, 30);
    const shadow = shell.getShadowRoot();
    const panel = shadow?.querySelector(".otf-agent-panel") as HTMLElement;
    expect(panel.hidden).toBe(false);

    (
      session as unknown as {
        agentPanel: {
          renderState: (state: {
            status: "preview";
            summary: string[];
            warnings: string[];
            criticWarnings: string[];
            validationErrors: string[];
            lastInstruction: string;
          }) => void;
        };
      }
    ).agentPanel.renderState({
      status: "preview",
      summary: [],
      warnings: [],
      criticWarnings: [],
      validationErrors: [],
      lastInstruction: "test",
    });

    shadow?.querySelector<HTMLButtonElement>("[data-agent-reject]")?.click();
    expect(panel.hidden).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("keeps grouped selection after unselecting and clicking a member again", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="a">A</p><p id="b">B</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const a = doc.querySelector("#a") as HTMLElement;
    const b = doc.querySelector("#b") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(a, { x: 20, y: 20, width: 120, height: 24 });
    layoutElement(b, { x: 20, y: 60, width: 120, height: 24 });

    const nodeA = createNode({ id: "a", rect: { x: 20, y: 20, width: 120, height: 24 } });
    const nodeB = createNode({ id: "b", rect: { x: 20, y: 60, width: 120, height: 24 } });
    const filler = [
      createNode({ id: "c", rect: { x: 20, y: 120, width: 120, height: 24 } }),
      createNode({ id: "d", rect: { x: 20, y: 160, width: 120, height: 24 } }),
    ];
    const graph = VisualLayoutGraph.fromScanResult(
      {
        nodes: new Map([nodeA, nodeB, ...filler].map((node) => [node.id, node])),
        rootNodeIds: ["a", "b", "c", "d"],
      },
      { width: 1000, height: 800 },
      1,
      1,
    );

    doc.elementsFromPoint = vi.fn((x: number, y: number) => {
      if (y < 45) {
        return [a, main, doc.body, doc.documentElement];
      }
      if (y < 85) {
        return [b, main, doc.body, doc.documentElement];
      }
      return [main, doc.body, doc.documentElement];
    });

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    const cache = (session as unknown as {
      cacheController: { cache: { ensureFresh: () => typeof graph; getGraph: () => typeof graph } };
    }).cacheController;
    vi.spyOn(cache.cache, "ensureFresh").mockReturnValue(graph);
    vi.spyOn(cache.cache, "getGraph").mockReturnValue(graph);

    dispatchPointer(win, a, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, a, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    dispatchPointer(win, b, "pointerdown", { clientX: 40, clientY: 70, buttons: 1, shiftKey: true });
    dispatchPointer(win, b, "pointerup", { clientX: 40, clientY: 70, buttons: 0, shiftKey: true });
    (session as unknown as { groupSelection: () => void }).groupSelection();

    session.clearSelection();
    const selectionController = (
      session as unknown as {
        selectionController: {
          getSelection: () => { activeGroupId?: string; selectedNodeIds: string[] };
          getActiveGroup: () => { memberIds: string[] } | null;
        };
      }
    ).selectionController;
    expect(selectionController.getActiveGroup()).not.toBeNull();
    expect(selectionController.getSelection().selectedNodeIds).toEqual([]);

    dispatchPointer(win, a, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, a, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });

    expect(selectionController.getSelection().selectedNodeIds.sort()).toEqual(["a", "b"]);
    expect(selectionController.getActiveGroup()?.memberIds.sort()).toEqual(["a", "b"]);

    session.stop();
    shell.unmount();
  });

  it("uses the grouped selection snapshot for agent context on group double-click", async () => {
    localAgentAvailable.value = true;
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="a">A</p><p id="b">B</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const a = doc.querySelector("#a") as HTMLElement;
    const b = doc.querySelector("#b") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(a, { x: 20, y: 20, width: 120, height: 24 });
    layoutElement(b, { x: 20, y: 60, width: 120, height: 24 });

    const nodeA = createNode({ id: "a", rect: { x: 20, y: 20, width: 120, height: 24 } });
    const nodeB = createNode({ id: "b", rect: { x: 20, y: 60, width: 120, height: 24 } });
    const filler = [
      createNode({ id: "c", rect: { x: 20, y: 120, width: 120, height: 24 } }),
      createNode({ id: "d", rect: { x: 20, y: 160, width: 120, height: 24 } }),
    ];
    const graph = VisualLayoutGraph.fromScanResult(
      {
        nodes: new Map([nodeA, nodeB, ...filler].map((node) => [node.id, node])),
        rootNodeIds: ["a", "b", "c", "d"],
      },
      { width: 1000, height: 800 },
      1,
      1,
    );

    doc.elementsFromPoint = vi.fn((x: number, y: number) => {
      if (y < 45) {
        return [a, main, doc.body, doc.documentElement];
      }
      if (y < 85) {
        return [b, main, doc.body, doc.documentElement];
      }
      return [main, doc.body, doc.documentElement];
    });

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    const cache = (session as unknown as {
      cacheController: { cache: { ensureFresh: () => typeof graph; getGraph: () => typeof graph } };
    }).cacheController;
    vi.spyOn(cache.cache, "ensureFresh").mockReturnValue(graph);
    vi.spyOn(cache.cache, "getGraph").mockReturnValue(graph);

    dispatchPointer(win, a, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, a, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    dispatchPointer(win, b, "pointerdown", { clientX: 40, clientY: 70, buttons: 1, shiftKey: true });
    dispatchPointer(win, b, "pointerup", { clientX: 40, clientY: 70, buttons: 0, shiftKey: true });
    (session as unknown as { groupSelection: () => void }).groupSelection();

    const groupedSelection = (
      session as unknown as { selectionController: { getSelection: () => { activeGroupId?: string; selectedNodeIds: string[] } } }
    ).selectionController.getSelection();
    expect(groupedSelection.activeGroupId).toBeTruthy();
    expect(groupedSelection.selectedNodeIds.length).toBeGreaterThanOrEqual(2);
    const groupedIds = [...groupedSelection.selectedNodeIds].sort();

    dispatchPointer(win, a, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, a, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    dispatchPointer(win, a, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, a, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });

    const context = session as unknown as {
      buildAgentContextInput: (instruction: string) => { selection: { selectedNodeIds: string[] } } | null;
      agentSelectionOverride: { selectedNodeIds: string[] } | null;
    };

    expect(context.agentSelectionOverride?.selectedNodeIds.sort()).toEqual(groupedIds);
    expect(context.buildAgentContextInput("Group edit")?.selection.selectedNodeIds.sort()).toEqual(
      groupedIds,
    );

    session.stop();
    shell.unmount();
  });

  it("groups with Ctrl+G and ungroups with Ctrl+Shift+G", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="a">A</p><p id="b">B</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const a = doc.querySelector("#a") as HTMLElement;
    const b = doc.querySelector("#b") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(a, { x: 20, y: 20, width: 120, height: 24 });
    layoutElement(b, { x: 20, y: 60, width: 120, height: 24 });

    const nodeA = createNode({ id: "a", rect: { x: 20, y: 20, width: 120, height: 24 } });
    const nodeB = createNode({ id: "b", rect: { x: 20, y: 60, width: 120, height: 24 } });
    const filler = [
      createNode({ id: "c", rect: { x: 20, y: 120, width: 120, height: 24 } }),
      createNode({ id: "d", rect: { x: 20, y: 160, width: 120, height: 24 } }),
    ];
    const graph = VisualLayoutGraph.fromScanResult(
      {
        nodes: new Map([nodeA, nodeB, ...filler].map((node) => [node.id, node])),
        rootNodeIds: ["a", "b", "c", "d"],
      },
      { width: 1000, height: 800 },
      1,
      1,
    );

    doc.elementsFromPoint = vi.fn((x: number, y: number) => {
      if (y < 45) {
        return [a, main, doc.body, doc.documentElement];
      }
      if (y < 85) {
        return [b, main, doc.body, doc.documentElement];
      }
      return [main, doc.body, doc.documentElement];
    });

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    const cache = (session as unknown as {
      cacheController: { cache: { ensureFresh: () => typeof graph; getGraph: () => typeof graph } };
    }).cacheController;
    vi.spyOn(cache.cache, "ensureFresh").mockReturnValue(graph);
    vi.spyOn(cache.cache, "getGraph").mockReturnValue(graph);

    dispatchPointer(win, a, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, a, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    dispatchPointer(win, b, "pointerdown", { clientX: 40, clientY: 70, buttons: 1, shiftKey: true });
    dispatchPointer(win, b, "pointerup", { clientX: 40, clientY: 70, buttons: 0, shiftKey: true });

    dispatchKey(win, doc, "g", { ctrlKey: true });

    const groupedSelection = (
      session as unknown as { selectionController: { getSelection: () => { activeGroupId?: string; selectedNodeIds: string[] } } }
    ).selectionController.getSelection();
    expect(groupedSelection.activeGroupId).toBeTruthy();
    expect(groupedSelection.selectedNodeIds.sort()).toEqual(["a", "b"]);

    dispatchKey(win, doc, "g", { ctrlKey: true, shiftKey: true });
    const ungroupedSelection = (
      session as unknown as { selectionController: { getSelection: () => { activeGroupId?: string; selectedNodeIds: string[] } } }
    ).selectionController.getSelection();
    expect(ungroupedSelection.activeGroupId).toBeUndefined();
    expect(ungroupedSelection.selectedNodeIds.sort()).toEqual(["a", "b"]);

    session.stop();
    shell.unmount();
  });

  it("restores persisted groups when members still resolve", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="a">A</p><p id="b">B</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const a = doc.querySelector("#a") as HTMLElement;
    const b = doc.querySelector("#b") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(a, { x: 20, y: 20, width: 120, height: 24 });
    layoutElement(b, { x: 20, y: 60, width: 120, height: 24 });

    const nodeA = createNode({ id: "a", rect: { x: 20, y: 20, width: 120, height: 24 } });
    const nodeB = createNode({ id: "b", rect: { x: 20, y: 60, width: 120, height: 24 } });
    const filler = [
      createNode({ id: "c", rect: { x: 20, y: 120, width: 120, height: 24 } }),
      createNode({ id: "d", rect: { x: 20, y: 160, width: 120, height: 24 } }),
    ];
    const graph = VisualLayoutGraph.fromScanResult(
      {
        nodes: new Map([nodeA, nodeB, ...filler].map((node) => [node.id, node])),
        rootNodeIds: ["a", "b", "c", "d"],
      },
      { width: 1000, height: 800 },
      1,
      1,
    );

    doc.elementsFromPoint = vi.fn((x: number, y: number) => {
      if (y < 45) {
        return [a, main, doc.body, doc.documentElement];
      }
      if (y < 85) {
        return [b, main, doc.body, doc.documentElement];
      }
      return [main, doc.body, doc.documentElement];
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

    const cache = (session as unknown as {
      cacheController: { cache: { ensureFresh: () => typeof graph; getGraph: () => typeof graph } };
    }).cacheController;
    vi.spyOn(cache.cache, "ensureFresh").mockReturnValue(graph);
    vi.spyOn(cache.cache, "getGraph").mockReturnValue(graph);

    dispatchPointer(win, a, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, a, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });
    dispatchPointer(win, b, "pointerdown", { clientX: 40, clientY: 70, buttons: 1, shiftKey: true });
    dispatchPointer(win, b, "pointerup", { clientX: 40, clientY: 70, buttons: 0, shiftKey: true });
    (session as unknown as { groupSelection: () => void }).groupSelection();

    const groupedSelection = (
      session as unknown as { selectionController: { getSelection: () => { activeGroupId?: string; selectedNodeIds: string[] } } }
    ).selectionController.getSelection();
    expect(groupedSelection.activeGroupId).toBeTruthy();
    expect(pageCustomization.getPageOperations().some((operation) => operation.type === "group")).toBe(
      true,
    );

    session.stop();
    shell.unmount();

    const shell2 = new EditorShell();
    shell2.mount({ onDeactivate: () => undefined });
    const session2 = createEditSession({
      shell: shell2,
      root: doc,
      pageCustomization,
    });
    await session2.start();

    expect(pageCustomization.getPageOperations().length).toBeGreaterThan(0);

    const cache2 = (session2 as unknown as {
      cacheController: { cache: { ensureFresh: () => typeof graph; getGraph: () => typeof graph } };
    }).cacheController;
    vi.spyOn(cache2.cache, "ensureFresh").mockReturnValue(graph);
    vi.spyOn(cache2.cache, "getGraph").mockReturnValue(graph);
    (session2 as unknown as { restorePersistedGroupSelection: () => void }).restorePersistedGroupSelection();

    const restoredSelection = (
      session2 as unknown as { selectionController: { getSelection: () => { activeGroupId?: string; selectedNodeIds: string[] } } }
    ).selectionController.getSelection();
    expect(restoredSelection.activeGroupId).toBeTruthy();
    expect(restoredSelection.selectedNodeIds.sort()).toEqual(["a", "b"]);

    session2.stop();
    shell2.unmount();
  });

  it("opens agent for the full group when double-clicking a nested child", async () => {
    localAgentAvailable.value = true;
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><section id="card"><span id="label">Title</span></section><p id="other">Other</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const card = doc.querySelector("#card") as HTMLElement;
    const label = doc.querySelector("#label") as HTMLElement;
    const other = doc.querySelector("#other") as HTMLElement;
    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(card, { x: 20, y: 20, width: 160, height: 80 });
    layoutElement(label, { x: 30, y: 30, width: 80, height: 20 });
    layoutElement(other, { x: 20, y: 120, width: 120, height: 24 });

    const cardNode = createNode({
      id: "card",
      kind: "container",
      rect: { x: 20, y: 20, width: 160, height: 80 },
      signature: {
        cssPath: "main section#card",
        tagName: "section",
        idAttr: "card",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
    });
    const labelNode = createNode({
      id: "label",
      rect: { x: 30, y: 30, width: 80, height: 20 },
      signature: {
        cssPath: "main section#card span#label",
        tagName: "span",
        idAttr: "label",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
    });
    const otherNode = createNode({ id: "other", rect: { x: 20, y: 120, width: 120, height: 24 } });
    const filler = [
      createNode({ id: "c", rect: { x: 20, y: 160, width: 120, height: 24 } }),
      createNode({ id: "d", rect: { x: 20, y: 190, width: 120, height: 24 } }),
    ];
    const graph = VisualLayoutGraph.fromScanResult(
      {
        nodes: new Map([cardNode, labelNode, otherNode, ...filler].map((node) => [node.id, node])),
        rootNodeIds: ["card", "label", "other", "c", "d"],
      },
      { width: 1000, height: 800 },
      1,
      1,
    );

    doc.elementsFromPoint = vi.fn((x: number, y: number) => {
      if (y < 55 && x < 100) {
        return [label, card, main, doc.body, doc.documentElement];
      }
      if (y < 55) {
        return [card, main, doc.body, doc.documentElement];
      }
      if (y < 140) {
        return [other, main, doc.body, doc.documentElement];
      }
      return [main, doc.body, doc.documentElement];
    });

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    const cache = (session as unknown as {
      cacheController: { cache: { ensureFresh: () => typeof graph; getGraph: () => typeof graph } };
    }).cacheController;
    vi.spyOn(cache.cache, "ensureFresh").mockReturnValue(graph);
    vi.spyOn(cache.cache, "getGraph").mockReturnValue(graph);

    dispatchPointer(win, card, "pointerdown", { clientX: 140, clientY: 35, buttons: 1 });
    dispatchPointer(win, card, "pointerup", { clientX: 140, clientY: 35, buttons: 0 });
    dispatchPointer(win, other, "pointerdown", { clientX: 40, clientY: 130, buttons: 1, shiftKey: true });
    dispatchPointer(win, other, "pointerup", { clientX: 40, clientY: 130, buttons: 0, shiftKey: true });
    (session as unknown as { groupSelection: () => void }).groupSelection();

    dispatchPointer(win, label, "pointerdown", { clientX: 40, clientY: 35, buttons: 1 });
    dispatchPointer(win, label, "pointerup", { clientX: 40, clientY: 35, buttons: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    dispatchPointer(win, label, "pointerdown", { clientX: 40, clientY: 35, buttons: 1 });
    dispatchPointer(win, label, "pointerup", { clientX: 40, clientY: 35, buttons: 0 });

    const context = session as unknown as {
      buildAgentContextInput: (instruction: string) => { selection: { selectedNodeIds: string[] } } | null;
      agentSelectionOverride: { selectedNodeIds: string[] } | null;
      selectionController: { getSelection: () => { activeGroupId?: string; selectedNodeIds: string[] } };
    };

    expect(context.agentSelectionOverride?.selectedNodeIds.sort()).toEqual(["card", "other"]);
    expect(context.selectionController.getSelection().activeGroupId).toBeTruthy();
    expect(context.buildAgentContextInput("Nested group edit")?.selection.selectedNodeIds.sort()).toEqual(
      ["card", "other"],
    );

    session.stop();
    shell.unmount();
  });
});
