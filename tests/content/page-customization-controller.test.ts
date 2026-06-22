import { describe, expect, it, vi } from "vitest";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import { createEditSession } from "../../src/content/edit-session.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import * as storageClient from "../../src/content/storage-client.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { createStyleOperation } from "../editor/fixtures.js";
import type { CropOperation } from "../../src/editor/operations.js";

describe("PageCustomizationController", () => {
  it("marks replay idempotent for a page load", async () => {
    const { document } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const controller = new PageCustomizationController(document);

    const first = await controller.ensureReplayed();
    const second = await controller.ensureReplayed();

    expect(first.pageKey).toBe(second.pageKey);
    expect(controller.isReplayed()).toBe(true);
  });

  it("clears replayed visible effects", async () => {
    const { document, root } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const copy = root.querySelector("#copy") as HTMLElement;
    const controller = new PageCustomizationController(document);

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

    controller.getAdapter().applyOperation(operation);
    controller.recordAppliedOperations([operation]);
    expect(copy.style.color).toBe("rgb(0, 128, 0)");

    await controller.clearPage();
    expect(copy.style.color).toBe("");
    expect(controller.getPageOperations()).toEqual([]);
  });

  it("clears replayed crop effects while edit mode is off", async () => {
    const { document, root } = createTestDocument(`<main><img id="photo" alt="x" /></main>`);
    const photo = root.querySelector("#photo") as HTMLElement;
    const controller = new PageCustomizationController(document);
    const operation: CropOperation = {
      id: "op-crop",
      type: "crop",
      pageKey: "https://example.com/",
      target: {
        nodeId: "node-1",
        signature: {
          cssPath: "main img#photo",
          tagName: "img",
          classList: [],
          idAttr: "photo",
          boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
        },
      },
      payload: { top: 8, right: 12, bottom: 4, left: 6 },
      createdAt: 1,
      source: "manual",
      status: "approved",
    };

    controller.getAdapter().applyOperation(operation);
    controller.recordAppliedOperations([operation]);
    expect(photo.style.clipPath).toBe("inset(8px 12px 4px 6px)");

    await controller.clearPage();

    expect(photo.style.clipPath).toBe("");
    expect(photo.getAttribute("data-otf-crop")).toBeNull();
    expect(controller.getPageOperations()).toEqual([]);
  });

  it("replays saved operations on load without edit mode", async () => {
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
      payload: { property: "color", value: "rgb(255, 0, 0)" },
    });

    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue([operation]);

    const controller = new PageCustomizationController(document);
    await controller.ensureReplayed();

    expect(copy.style.color).toBe("rgb(255, 0, 0)");
    expect(controller.isReplayed()).toBe(true);
  });

  it("does not double-apply when edit mode starts after page-load replay", async () => {
    const { document } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
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
      payload: { property: "color", value: "rgb(0, 0, 255)" },
    });

    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue([operation]);

    const controller = new PageCustomizationController(document);
    const adapter = controller.getAdapter();
    const replaySpy = vi.spyOn(adapter, "replayOperationsWithDiagnostics");

    await controller.ensureReplayed();
    expect(replaySpy).toHaveBeenCalledTimes(1);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({ shell, root: document, pageCustomization: controller });
    await session.start();

    expect(replaySpy).toHaveBeenCalledTimes(1);

    session.stop();
    shell.unmount();
  });
});
