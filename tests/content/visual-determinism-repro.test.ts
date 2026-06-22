import { afterEach, describe, expect, it, vi } from "vitest";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { createTransformController } from "../../src/content/transform-controller.js";
import { createStyleTextController } from "../../src/content/style-text-controller.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { extractBoundingBox } from "../../src/editor/measurement/bounding-box.js";
import { OTF_DETACH_ATTR } from "../../src/editor/dom/managed-detach.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import * as storageClient from "../../src/content/storage-client.js";
import type { TransformTarget } from "../../src/editor/transform/index.js";

/**
 * Visual-determinism regression repros. Unlike the existing determinism suite,
 * every card here has CHILD ELEMENTS, which is exactly the case that the
 * destructive snapshot restore (textContent overwrite + computed-style baking)
 * silently corrupted. These lock Invariants B, C, D, and E.
 */

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

function targetFor(
  element: HTMLElement,
  cssPath: string,
  rect: { x: number; y: number; width: number; height: number },
): TransformTarget {
  return {
    nodeId: cssPath,
    signature: {
      cssPath,
      tagName: element.tagName.toLowerCase(),
      classList: Array.from(element.classList),
      boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
    },
    rect: { ...rect },
    element,
  };
}

describe("visual determinism repros (cards with child elements)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Invariant B: undo then redo of a move preserves the card subtree and geometry", () => {
    const { document } = createTestDocument(
      `<main><section class="profile-card"><h2 class="name">Ada</h2><p class="bio">Engineer</p></section></main>`,
    );
    const card = document.querySelector(".profile-card") as HTMLElement;
    const base = { x: 80, y: 120, width: 280, height: 180 };
    layoutWithTransform(card, base);

    const pageCustomization = new PageCustomizationController(document);
    const adapter = pageCustomization.getAdapter();
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter,
      getPageKey: () => "https://example.com/profile",
    });

    const target = targetFor(card, "main section.profile-card", base);
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...base }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(120, 150);
    const ops = controller.endMove(180, 210);
    expect(ops).toHaveLength(1);

    const movedRect = extractBoundingBox(card);
    expect(movedRect.x).toBeGreaterThan(base.x);
    expect(card.querySelector(".name")).toBeTruthy();

    const snapshot = adapter.buildBatchSnapshot(ops);

    // Undo
    adapter.restoreBatchSnapshot(snapshot, "before");
    expect(card.querySelector(".name"), "child <h2> must survive undo").toBeTruthy();
    expect(card.querySelector(".bio"), "child <p> must survive undo").toBeTruthy();
    expect(rectsClose(extractBoundingBox(card), base)).toBe(true);

    // Redo
    adapter.restoreBatchSnapshot(snapshot, "after");
    expect(card.querySelector(".name"), "child <h2> must survive redo").toBeTruthy();
    expect(card.querySelector(".bio"), "child <p> must survive redo").toBeTruthy();
    expect(rectsClose(extractBoundingBox(card), movedRect)).toBe(true);
  });

  it("Invariant C: clear all immediately restores the live subtree and geometry", async () => {
    const { document } = createTestDocument(
      `<main><section class="profile-card"><h2 class="name">Ada</h2><p class="bio">Engineer</p></section></main>`,
    );
    const card = document.querySelector(".profile-card") as HTMLElement;
    const base = { x: 80, y: 120, width: 280, height: 180 };
    layoutWithTransform(card, base);

    vi.spyOn(storageClient, "clearPageOperations").mockResolvedValue(true);

    const pageCustomization = new PageCustomizationController(document);
    const adapter = pageCustomization.getAdapter();
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter,
      getPageKey: () => "https://example.com/profile",
    });

    const target = targetFor(card, "main section.profile-card", base);
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...base }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(120, 150);
    controller.endMove(220, 260);
    expect(extractBoundingBox(card).x).toBeGreaterThan(base.x);

    await pageCustomization.clearPage();

    expect(card.querySelector(".name"), "child <h2> must survive clear").toBeTruthy();
    expect(card.querySelector(".bio"), "child <p> must survive clear").toBeTruthy();
    expect(rectsClose(extractBoundingBox(card), base)).toBe(true);
    expect(card.parentElement?.tagName.toLowerCase()).toBe("main");
  });

  it("Invariant E: a background-color change leaves the subtree and geometry unchanged", () => {
    const { document } = createTestDocument(
      `<main><section class="profile-card"><h2 class="name">Ada</h2><p class="bio">Engineer</p></section></main>`,
    );
    const card = document.querySelector(".profile-card") as HTMLElement;
    const base = { x: 80, y: 120, width: 280, height: 180 };
    layoutWithTransform(card, base);

    const pageCustomization = new PageCustomizationController(document);
    const adapter = pageCustomization.getAdapter();
    const target = targetFor(card, "main section.profile-card", base);
    const styleController = createStyleTextController({
      document,
      adapter,
      getPageKey: () => "https://example.com/profile",
      resolveTargets: () => [target],
      resolveTextTarget: () => null,
    });

    // Two previews: the second reverts the first (snapshot restore on the card).
    styleController.previewStyle("backgroundColor", "rgb(255, 0, 0)");
    styleController.previewStyle("backgroundColor", "rgb(0, 128, 255)");

    expect(card.querySelector(".name"), "child <h2> must survive style preview").toBeTruthy();
    expect(card.querySelector(".bio"), "child <p> must survive style preview").toBeTruthy();
    expect(rectsClose(extractBoundingBox(card), base)).toBe(true);
    expect(card.style.backgroundColor).toBe("rgb(0, 128, 255)");

    styleController.commitStylePreview();
    expect(card.querySelector(".name"), "child <h2> must survive style commit").toBeTruthy();
    expect(rectsClose(extractBoundingBox(card), base)).toBe(true);
  });

  it("Invariant D/A: a detached move persists the moved geometry, not the post-detach reflow", () => {
    const { document } = createTestDocument(
      `<main><div class="wrap"><section class="card"><h3 class="t">Title</h3></section></div></main>`,
    );
    const card = document.querySelector(".card") as HTMLElement;
    const base = { x: 60, y: 90, width: 240, height: 160 };
    layoutWithTransform(card, base);

    const pageCustomization = new PageCustomizationController(document);
    const adapter = pageCustomization.getAdapter();
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter,
      getPageKey: () => "https://example.com/cards",
    });

    const target = targetFor(card, "main div.wrap section.card", base);
    controller.setSelection({
      targets: [target],
      outlineRects: [{ ...base }],
      variant: "node",
      handleTarget: target,
    });
    controller.beginMove(100, 100);
    const ops = controller.endMove(140, 150); // dx=40, dy=50

    // The card sits in a non-main wrapper, so it detaches to <body>.
    expect(card.getAttribute(OTF_DETACH_ATTR)).toBe("true");
    expect(card.parentElement?.tagName.toLowerCase()).toBe("body");
    expect(card.querySelector(".t"), "child must survive detach").toBeTruthy();

    const finalRect = ops[0]?.metadata?.finalRect;
    expect(finalRect).toBeTruthy();
    // The persisted geometry must be the moved position (base + delta), captured
    // BEFORE the detach stripped the live translate — not the original position.
    expect(finalRect?.x).toBeCloseTo(base.x + 40, 0);
    expect(finalRect?.y).toBeCloseTo(base.y + 50, 0);
  });

  it("Invariant D: two independently-detached cards each persist their own moved geometry", () => {
    const { document } = createTestDocument(
      `<main>
        <div class="wrap-a"><section class="card-a"><h3 class="t">A</h3></section></div>
        <div class="wrap-b"><section class="card-b"><h3 class="t">B</h3></section></div>
      </main>`,
    );
    const cardA = document.querySelector(".card-a") as HTMLElement;
    const cardB = document.querySelector(".card-b") as HTMLElement;
    const baseA = { x: 40, y: 80, width: 200, height: 140 };
    const baseB = { x: 320, y: 80, width: 200, height: 140 };
    layoutWithTransform(cardA, baseA);
    layoutWithTransform(cardB, baseB);

    const pageCustomization = new PageCustomizationController(document);
    const adapter = pageCustomization.getAdapter();
    const controller = createTransformController({
      shell: createFakeShell(),
      document,
      adapter,
      getPageKey: () => "https://example.com/cards",
    });

    const targetA = targetFor(cardA, "main div.wrap-a section.card-a", baseA);
    const targetB = targetFor(cardB, "main div.wrap-b section.card-b", baseB);
    controller.setSelection({
      targets: [targetA, targetB],
      outlineRects: [{ ...baseA }, { ...baseB }],
      variant: "group",
      handleTarget: null,
    });
    controller.beginMove(100, 100);
    const ops = controller.endMove(130, 130); // dx=30, dy=30

    const finalA = ops[0]?.metadata?.finalRect;
    const finalB = ops[1]?.metadata?.finalRect;
    expect(finalA).toBeTruthy();
    expect(finalB).toBeTruthy();

    // Each card keeps its own moved geometry; relative offset is preserved.
    expect(finalA?.x).toBeCloseTo(baseA.x + 30, 0);
    expect(finalB?.x).toBeCloseTo(baseB.x + 30, 0);
    expect((finalB?.x ?? 0) - (finalA?.x ?? 0)).toBeCloseTo(baseB.x - baseA.x, 0);
  });
});
