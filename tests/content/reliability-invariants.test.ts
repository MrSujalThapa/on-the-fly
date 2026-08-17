/**
 * V.2–V.5 characterization of data-integrity invariants (ARCHITECTURE_AUDIT §V).
 *
 * These currently fail: the product reports success when a lower layer failed.
 * Marked `it.fails` until P0.1 consumes those results. Flip each to `it` when
 * the matching fix lands.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditSession } from "../../src/content/edit-session.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { createTestPageCustomization } from "./edit-session-test-helpers.js";
import {
  createTransformController,
  type TransformSelectionInput,
} from "../../src/content/transform-controller.js";
import { DomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";
import { createDomApplyFailure } from "../../src/editor/dom/types.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import type { TransformTarget } from "../../src/editor/transform/transform-target.js";
import type { VisualNodeRect } from "../../src/editor/visual-node.js";
import type { EditorOperation } from "../../src/editor/operations.js";
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

function saveButton(shell: EditorShell): HTMLButtonElement | null {
  return shell.getShadowRoot()?.querySelector(".otf-save-button") ?? null;
}

const liveSessions: Array<{ stop: () => void }> = [];
const liveShells: EditorShell[] = [];

async function startStyledSession(options: {
  onDebug?: (message: string, data?: unknown) => void;
}): Promise<{
  session: ReturnType<typeof createEditSession>;
  shell: EditorShell;
  pageCustomization: PageCustomizationController;
  copy: HTMLElement;
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
  const session = createEditSession({
    shell,
    root: doc,
    pageCustomization,
    ...(options.onDebug ? { onDebug: options.onDebug } : {}),
  });
  await session.start();
  liveSessions.push(session);
  liveShells.push(shell);

  dispatchPointer(win, copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
  dispatchPointer(win, copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
  session.applyStyle("color", "rgb(255, 0, 0)");

  return { session, shell, pageCustomization, copy };
}

function layoutWithTransform(element: HTMLElement, base: VisualNodeRect): void {
  element.getBoundingClientRect = () => {
    const match = /translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/.exec(
      element.style.transform,
    );
    const dx = match ? Number(match[1]) : 0;
    const dy = match ? Number(match[2]) : 0;
    const x = base.x + dx;
    const y = base.y + dy;
    return {
      x,
      y,
      width: base.width,
      height: base.height,
      top: y,
      left: x,
      right: x + base.width,
      bottom: y + base.height,
      toJSON: () => ({}),
    };
  };
}

function makeLiveTarget(
  element: HTMLElement,
  className: string,
  rect: VisualNodeRect,
): TransformTarget {
  return {
    nodeId: className,
    signature: {
      cssPath: `main .${className}`,
      tagName: "div",
      classList: [className],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
    rect,
    element,
  };
}

function nodeInput(targets: TransformTarget[]): TransformSelectionInput {
  return {
    targets,
    outlineRects: targets.map((target) => ({ ...target.rect })),
    variant: "node",
    handleTarget: targets.length === 1 ? (targets[0] ?? null) : null,
  };
}

describe("reliability invariants V.2–V.5", () => {
  afterEach(() => {
    for (const session of liveSessions.splice(0)) {
      session.stop();
    }
    for (const shell of liveShells.splice(0)) {
      shell.unmount();
    }
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
    vi.restoreAllMocks();
  });

  it.fails("V.2 failed save keeps drafts dirty and reports failure", async () => {
    vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({
      ok: false,
      error: "quota_exceeded",
    });

    const { session, shell, pageCustomization } = await startStyledSession({});
    expect(session.hasUnsavedChanges()).toBe(true);
    const draftCount = session.getUnsavedChangeCount();
    expect(draftCount).toBeGreaterThan(0);

    const saved = await session.saveAll();

    expect(saved).toBe(false);
    expect(session.hasUnsavedChanges()).toBe(true);
    expect(session.getUnsavedChangeCount()).toBe(draftCount);
    expect(saveButton(shell)?.hidden).toBe(false);
    expect(saveButton(shell)?.textContent).toMatch(/unsaved/i);
    expect(
      pageCustomization.getPageOperations().every((operation) => operation.status !== "approved"),
    ).toBe(true);

    session.stop();
    shell.unmount();
  });

  it.fails("V.3 cap trim is consumed and surfaced instead of silent success", async () => {
    vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({
      ok: true,
      capReached: true,
      trimmed: 3,
      operationCount: 50,
    });

    const debugEvents: Array<{ message: string; data: unknown }> = [];
    const { session, shell } = await startStyledSession({
      onDebug: (message, data) => {
        debugEvents.push({ message, data });
      },
    });

    const saved = await session.saveAll();

    expect(saved).toBe(true);
    expect(session.hasUnsavedChanges()).toBe(false);
    expect(saveButton(shell)?.hidden).toBe(true);

    const capEvent = debugEvents.find((event) => event.message === "save-cap-reached");
    expect(capEvent).toBeDefined();
    expect(capEvent?.data).toEqual(
      expect.objectContaining({
        trimmed: 3,
        capReached: true,
      }),
    );

    session.stop();
    shell.unmount();
  });

  it.fails("V.4 clear reports failure and does not pretend the page was wiped", async () => {
    vi.spyOn(storageClient, "replacePageOperations").mockResolvedValue({ ok: true });
    vi.spyOn(storageClient, "clearPageOperations").mockResolvedValue(false);

    const { session, shell, pageCustomization, copy } = await startStyledSession({});
    await session.saveAll();
    expect(session.hasUnsavedChanges()).toBe(false);
    expect(copy.style.color).toBe("rgb(255, 0, 0)");

    const persistedBefore = [...pageCustomization.getPageOperations()];
    expect(persistedBefore.length).toBeGreaterThan(0);

    await session.clearPage();

    expect(copy.style.color).toBe("rgb(255, 0, 0)");
    expect(pageCustomization.getPageOperations()).toEqual(persistedBefore);
    expect(session.canUndo()).toBe(true);

    session.stop();
    shell.unmount();
  });

  it.fails("V.5 only successfully applied operations enter drafts and history", () => {
    const { document } = createTestDocument(
      `<main>
        <div class="box-a">A</div>
        <div class="box-b">B</div>
        <div class="box-c">C</div>
      </main>`,
    );
    const elementA = document.querySelector(".box-a") as HTMLElement;
    const elementB = document.querySelector(".box-b") as HTMLElement;
    const elementC = document.querySelector(".box-c") as HTMLElement;
    layoutWithTransform(elementA, { x: 20, y: 20, width: 80, height: 30 });
    layoutWithTransform(elementB, { x: 20, y: 60, width: 80, height: 30 });
    layoutWithTransform(elementC, { x: 20, y: 100, width: 80, height: 30 });

    const recorded: EditorOperation[] = [];
    const applyFailures: Array<{ code: string; error: string }> = [];
    const adapter = new DomRuntimeAdapter(document);
    const originalApply = adapter.applyOperation.bind(adapter);
    let applyIndex = 0;
    adapter.applyOperation = (operation, override) => {
      applyIndex += 1;
      if (applyIndex === 2) {
        return createDomApplyFailure("target_not_found", "forced_partial_apply");
      }
      return originalApply(operation, override);
    };

    const shell = {
      setHandlePointerDownHandler: () => undefined,
      clearOverlays: () => undefined,
      clearOverlayTranslate: () => undefined,
      translateOverlay: () => undefined,
      renderSelectionOutlines: () => undefined,
    } as unknown as EditorShell;

    const controller = createTransformController({
      shell,
      document,
      adapter,
      getPageKey: () => "https://example.com/",
      onApply: (operations) => {
        recorded.push(...operations);
      },
      onDebug: (message, data) => {
        if (message === "transform-apply-failed" && data && typeof data === "object") {
          applyFailures.push(data as { code: string; error: string });
        }
      },
    });

    const targets = [
      makeLiveTarget(elementA, "box-a", { x: 20, y: 20, width: 80, height: 30 }),
      makeLiveTarget(elementB, "box-b", { x: 20, y: 60, width: 80, height: 30 }),
      makeLiveTarget(elementC, "box-c", { x: 20, y: 100, width: 80, height: 30 }),
    ];
    controller.setSelection(nodeInput(targets));
    controller.beginMove(40, 40);
    const returned = controller.endMove(60, 70);

    expect(applyFailures.length).toBeGreaterThan(0);
    expect(returned).toHaveLength(2);
    expect(recorded).toHaveLength(2);
    expect(recorded.map((operation) => operation.target.nodeId).sort()).toEqual(["box-a", "box-c"]);
    expect(returned.every((operation) => recorded.includes(operation))).toBe(true);
  });
});
