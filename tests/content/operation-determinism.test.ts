import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditSession } from "../../src/content/edit-session.js";
import { createTestPageCustomization } from "./edit-session-test-helpers.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { SaveWindowController } from "../../src/content/save-window-controller.js";
import { DomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";
import { createSessionHistory } from "../../src/content/session-history.js";
import { createSessionOperationState } from "../../src/content/session-operation-state.js";
import { createTransformController } from "../../src/content/transform-controller.js";
import type { EditorOperation } from "../../src/editor/operations.js";
import { extractBoundingBox } from "../../src/editor/measurement/bounding-box.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";
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

function createFakeShell(): EditorShell {
  return {
    setHandlePointerDownHandler: () => undefined,
    clearOverlays: () => undefined,
    clearOverlayTranslate: () => undefined,
    translateOverlay: () => undefined,
    renderSelectionOutlines: () => undefined,
  } as unknown as EditorShell;
}

function layoutWithTransform(element: HTMLElement, base: { x: number; y: number; width: number; height: number }): void {
  element.getBoundingClientRect = () => {
    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(element.style.transform);
    const dx = match ? Number.parseFloat(match[1] ?? "0") : 0;
    const dy = match ? Number.parseFloat(match[2] ?? "0") : 0;
    const width = element.style.width ? Number.parseFloat(element.style.width) : base.width;
    const height = element.style.height ? Number.parseFloat(element.style.height) : base.height;
    const x = base.x + dx;
    const y = base.y + dy;
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
  };
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

function rectsClose(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  tolerance = 1,
): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

describe("operation determinism", () => {
  afterEach(() => {
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
    vi.restoreAllMocks();
  });

  it("replays saved move on profile card at the same visual rect after refresh", () => {
    const { document, root } = createTestDocument(
      `<main><section class="profile-card"><h2 class="profile-name">Ada Lovelace</h2></section></main>`,
    );
    const card = document.querySelector(".profile-card") as HTMLElement;
    layoutWithTransform(card, { x: 80, y: 120, width: 280, height: 180 });

    const pageCustomization = new PageCustomizationController(document);
    const adapter = pageCustomization.getAdapter();
    const shell = createFakeShell();
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/profile",
      onApply: () => undefined,
    });

    const target = {
      nodeId: "profile-card",
      signature: {
        cssPath: "main section.profile-card",
        tagName: "section",
        classList: ["profile-card"],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 80, y: 120, width: 280, height: 180 },
      element: card,
    };

    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(120, 150);
    const moveOps = controller.endMove(180, 210);
    expect(moveOps).toHaveLength(1);

    const afterMove = extractBoundingBox(card);
    expect(afterMove.x).toBeGreaterThan(80);
    expect(moveOps[0]?.metadata?.finalRect).toBeTruthy();

    card.removeAttribute("style");
    card.removeAttribute("data-otf-managed");
    card.removeAttribute("data-otf-transform");
    card.removeAttribute("data-otf-detached");
    layoutWithTransform(card, { x: 80, y: 120, width: 280, height: 180 });
    expect(extractBoundingBox(card).x).toBe(80);

    const replayAdapter = new DomRuntimeAdapter(root);
    replayAdapter.replayOperations(moveOps);
    const replayedRect = extractBoundingBox(document.querySelector(".profile-card") as HTMLElement);
    expect(rectsClose(replayedRect, afterMove)).toBe(true);
  });

  it("clear page restores a moved profile card to its original rect immediately", async () => {
    const { document } = createTestDocument(
      `<main><section class="profile-card"><h2>Ada</h2></section></main>`,
    );
    const card = document.querySelector(".profile-card") as HTMLElement;
    layoutWithTransform(card, { x: 80, y: 120, width: 280, height: 180 });
    const originalRect = extractBoundingBox(card);

    vi.spyOn(storageClient, "clearPageOperations").mockResolvedValue(true);

    const pageCustomization = new PageCustomizationController(document);
    const adapter = pageCustomization.getAdapter();
    const shell = createFakeShell();
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/profile",
      onApply: () => undefined,
    });

    const target = {
      nodeId: "profile-card",
      signature: {
        cssPath: "main section.profile-card",
        tagName: "section",
        classList: ["profile-card"],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 80, y: 120, width: 280, height: 180 },
      element: card,
    };
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...target.rect }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(120, 150);
    controller.endMove(220, 260);
    expect(extractBoundingBox(card).x).toBeGreaterThan(originalRect.x);

    await pageCustomization.clearPage();

    const clearedRect = extractBoundingBox(card);
    expect(rectsClose(clearedRect, originalRect)).toBe(true);
    expect(card.parentElement?.tagName.toLowerCase()).toBe("main");
  });

  it("undo and redo restore move/hide snapshots without losing elements", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;
    doc.body.innerHTML = `<main><section class="profile-card">Profile</section></main>`;
    const card = doc.querySelector(".profile-card") as HTMLElement;
    layoutElement(card, { x: 80, y: 120, width: 280, height: 180 });
    layoutWithTransform(card, { x: 80, y: 120, width: 280, height: 180 });
    doc.elementsFromPoint = () => [card, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({ shell, root: doc, pageCustomization: createTestPageCustomization(doc) });
    await session.start();

    dispatchPointer(win, card, "pointerdown", { clientX: 90, clientY: 130, buttons: 1 });
    dispatchPointer(win, card, "pointerup", { clientX: 90, clientY: 130, buttons: 0 });
    dispatchPointer(win, card, "pointerdown", { clientX: 100, clientY: 140, buttons: 1 });
    dispatchPointer(win, card, "pointermove", { clientX: 160, clientY: 200, buttons: 1 });
    dispatchPointer(win, card, "pointerup", { clientX: 160, clientY: 200, buttons: 0 });

    const movedRect = extractBoundingBox(card);
    expect(movedRect.x).toBeGreaterThan(80);

    expect(session.undo()).toBe(true);
    expect(card.isConnected).toBe(true);
    expect(rectsClose(extractBoundingBox(card), { x: 80, y: 120, width: 280, height: 180 })).toBe(true);

    expect(session.redo()).toBe(true);
    expect(card.isConnected).toBe(true);
    expect(rectsClose(extractBoundingBox(card), movedRect)).toBe(true);

    session.hideSelection();
    expect(card.style.display).toBe("none");
    expect(session.undo()).toBe(true);
    expect(card.style.display).not.toBe("none");
    expect(card.isConnected).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("save window keeps inside-window drafts and reverts outside drafts by final rect", async () => {
    const { document, root } = createTestDocument(
      `<main><section class="profile-card">Profile</section><p id="footer-note">Footer</p></main>`,
    );
    const card = root.querySelector(".profile-card") as HTMLElement;
    const footer = root.querySelector("#footer-note") as HTMLElement;
    layoutElement(card, { x: 80, y: 120, width: 280, height: 180 });
    layoutElement(footer, { x: 80, y: 360, width: 280, height: 24 });
    layoutWithTransform(card, { x: 80, y: 120, width: 280, height: 180 });

    const pageCustomization = new PageCustomizationController(document);
    const adapter = pageCustomization.getAdapter();
    const shell = createFakeShell();
    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/profile",
      onApply: () => undefined,
    });

    const cardTarget = {
      nodeId: "profile-card",
      signature: {
        cssPath: "main section.profile-card",
        tagName: "section",
        classList: ["profile-card"],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 80, y: 120, width: 280, height: 180 },
      element: card,
    };

    controller.setSelection({
      targets: [cardTarget],
      outlineRects: [{ ...cardTarget.rect }],
      variant: "node",
      handleTarget: cardTarget,
    });
    controller.beginMove(120, 150);
    const cardMoveOps = controller.endMove(140, 170);

    const footerSession = createEditSession({
      shell: new EditorShell(),
      root: document,
      pageCustomization: createTestPageCustomization(document),
    });
    await footerSession.start();
    dispatchPointer(globalThis.window, footer, "pointerdown", { clientX: 90, clientY: 365, buttons: 1 });
    dispatchPointer(globalThis.window, footer, "pointerup", { clientX: 90, clientY: 365, buttons: 0 });
    footerSession.applyStyle("color", "rgb(255, 0, 0)");
    const footerOps = (footerSession as unknown as { operationState: { draftOperations: EditorOperation[] } })
      .operationState.draftOperations;
    footerSession.stop();

    vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({ ok: true });

    const realShell = new EditorShell();
    realShell.mount({ onDeactivate: () => undefined });

    let operationState = createSessionOperationState([]);
    operationState = {
      ...operationState,
      draftOperations: [...cardMoveOps, ...footerOps],
    };

    const saveWindow = new SaveWindowController({
      shell: realShell,
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

    saveWindow.start();
    driveSaveWindowDraw(saveWindow, { x: 60, y: 90 }, { x: 380, y: 320 });
    await saveWindow.confirm();

    expect(operationState.savedOperations.map((op) => op.id)).toContain(cardMoveOps[0]?.id);
    expect(footer.style.color).toBe("");
    expect(extractBoundingBox(card).x).toBeGreaterThan(80);

    realShell.unmount();
  });
});
