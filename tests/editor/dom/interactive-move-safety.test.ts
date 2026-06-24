import { describe, expect, it, vi } from "vitest";
import { createTransformController } from "../../../src/content/transform-controller.js";
import { DomRuntimeAdapter } from "../../../src/editor/dom/dom-runtime-adapter.js";
import { extractBoundingBox } from "../../../src/editor/measurement/bounding-box.js";
import { OTF_DETACH_ATTR } from "../../../src/editor/dom/managed-detach.js";
import { OTF_INTERACTION_FIXED_ATTR } from "../../../src/editor/dom/types.js";
import { createTestDocument } from "./test-document.js";
import { layoutElement, layoutManagedElement } from "../measurement/layout-helpers.js";
import type { EditorShell } from "../../../src/content/editor-shell.js";
import type { TransformSelectionInput } from "../../../src/content/transform-controller.js";

function createFakeShell(): EditorShell {
  return {
    setHandlePointerDownHandler: () => undefined,
    clearOverlays: () => undefined,
    clearOverlayTranslate: () => undefined,
    translateOverlay: () => undefined,
    renderSelectionOutlines: () => undefined,
  } as unknown as EditorShell;
}

function layoutElementLocal(
  element: HTMLElement,
  base: { x: number; y: number; width: number; height: number },
): void {
  layoutManagedElement(element, base);
}

function nodeInput(target: TransformSelectionInput["targets"][number]): TransformSelectionInput {
  return {
    targets: [target],
    outlineRects: [{ ...target.rect }],
    variant: "node",
    handleTarget: target,
  };
}

describe("interactive move safety", () => {
  it("does not detach moved buttons and uses interaction-safe fixed placement", () => {
    const { document } = createTestDocument(
      `<main><section class="card"><button class="premium">Reactivate Premium</button></section></main>`,
    );
    const card = document.querySelector(".card") as HTMLElement;
    const button = document.querySelector(".premium") as HTMLButtonElement;
    layoutElement(card, { x: 40, y: 40, width: 300, height: 160 });
    layoutElementLocal(button, { x: 50, y: 60, width: 180, height: 36 });

    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter,
      getPageKey: () => "https://example.com/",
    });

    const buttonTarget = {
      nodeId: "premium",
      signature: {
        cssPath: "main section.card > button.premium",
        tagName: "button",
        classList: ["premium"],
        textFingerprint: "Reactivate Premium",
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 50, y: 60, width: 180, height: 36 },
      element: button,
    };

    controller.setSelection(nodeInput(buttonTarget));
    controller.beginMove(50, 60);
    const moveOps = controller.endMove(350, 60);

    expect(moveOps[0]?.type).toBe("move");
    if (moveOps[0]?.type === "move") {
      expect(moveOps[0].payload.detached).not.toBe(true);
    }
    expect(button.getAttribute(OTF_DETACH_ATTR)).not.toBe("true");
    expect(button.getAttribute(OTF_INTERACTION_FIXED_ATTR)).toBe("true");
    expect(button.parentElement).toBe(card);
    expect(button.style.position === "fixed" || button.style.position === "absolute").toBe(true);
    expect(extractBoundingBox(button).x).toBe(350);
  });

  it("keeps delegated click listeners on the original app root after move", () => {
    const { document } = createTestDocument(
      `<main id="app-root"><nav class="tabs"><button class="tab" data-tab="settings">Settings</button></nav></main>`,
    );
    const appRoot = document.querySelector("#app-root") as HTMLElement;
    const tab = document.querySelector(".tab") as HTMLButtonElement;
    layoutElement(appRoot, { x: 0, y: 0, width: 800, height: 600 });
    layoutElementLocal(tab, { x: 20, y: 20, width: 120, height: 36 });

    const rootClick = vi.fn();
    appRoot.addEventListener("click", rootClick);

    const adapter = new DomRuntimeAdapter(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter,
      getPageKey: () => "https://example.com/app",
    });

    const tabTarget = {
      nodeId: "settings-tab",
      signature: {
        cssPath: "main#app-root nav.tabs > button.tab",
        tagName: "button",
        classList: ["tab"],
        textFingerprint: "Settings",
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 20, y: 20, width: 120, height: 36 },
      element: tab,
    };

    controller.setSelection(nodeInput(tabTarget));
    controller.beginMove(20, 20);
    controller.endMove(260, 20);

    tab.click();
    expect(rootClick).toHaveBeenCalledTimes(1);
    expect(tab.parentElement?.classList.contains("tabs")).toBe(true);
  });
});
