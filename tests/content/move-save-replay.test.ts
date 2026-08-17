import { afterEach, describe, expect, it, vi } from "vitest";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { createTransformController } from "../../src/content/transform-controller.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { extractBoundingBox } from "../../src/editor/measurement/bounding-box.js";
import type { EditorOperation } from "../../src/editor/operations.js";
import { createTestDocument } from "../editor/dom/test-document.js";
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

function layoutWithTransform(
  element: HTMLElement,
  base: { x: number; y: number; width: number; height: number },
): void {
  element.getBoundingClientRect = () => {
    if (element.style.position === "fixed" || element.style.position === "absolute") {
      const x = Number.parseFloat(element.style.left) || base.x;
      const y = Number.parseFloat(element.style.top) || base.y;
      const width = element.style.width ? Number.parseFloat(element.style.width) : base.width;
      const height = element.style.height ? Number.parseFloat(element.style.height) : base.height;
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
    }

    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(element.style.transform);
    const dx = match ? Number.parseFloat(match[1] ?? "0") : 0;
    const dy = match ? Number.parseFloat(match[2] ?? "0") : 0;
    return {
      x: base.x + dx,
      y: base.y + dy,
      width: base.width,
      height: base.height,
      top: base.y + dy,
      left: base.x + dx,
      right: base.x + dx + base.width,
      bottom: base.y + dy + base.height,
      toJSON: () => ({}),
    };
  };
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

describe("V.1 move save reload replay", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replays a saved move through persistence at the committed geometry", async () => {
    const store = new Map<string, EditorOperation[]>();
    vi.spyOn(storageClient, "loadPageOperations").mockImplementation((pageKey) => {
      return Promise.resolve([...(store.get(pageKey) ?? [])]);
    });
    vi.spyOn(storageClient, "replacePageOperations").mockImplementation((pageKey, operations) => {
      store.set(pageKey, [...operations]);
      return Promise.resolve({ ok: true, operationCount: operations.length });
    });

    const { document } = createTestDocument(
      `<main><section class="profile-card"><h2>Ada Lovelace</h2></section></main>`,
    );
    const card = document.querySelector(".profile-card") as HTMLElement;
    layoutWithTransform(card, { x: 80, y: 120, width: 280, height: 180 });

    const live = new PageCustomizationController(document);
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter: live.getAdapter(),
      getPageKey: () => live.getPageKey(),
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

    live.setPageOperations(moveOps);
    const saved = await live.syncOperationsToStorage();
    expect(saved.ok).toBe(true);

    const committed = extractBoundingBox(card);

    card.removeAttribute("style");
    card.removeAttribute("data-otf-managed");
    card.removeAttribute("data-otf-transform");
    card.removeAttribute("data-otf-detached");
    layoutWithTransform(card, { x: 80, y: 120, width: 280, height: 180 });
    expect(extractBoundingBox(card).x).toBe(80);

    const reloaded = new PageCustomizationController(document);
    const replay = await reloaded.ensureReplayed();
    expect(replay.failed).toBe(0);
    expect(replay.unresolved).toBe(0);
    expect(reloaded.getPageOperations()).toHaveLength(1);

    const replayed = extractBoundingBox(document.querySelector(".profile-card") as HTMLElement);
    expect(rectsClose(replayed, committed)).toBe(true);

    live.dispose();
    reloaded.dispose();
  });
});
