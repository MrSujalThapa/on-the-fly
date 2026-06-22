import { afterEach, describe, expect, it, vi } from "vitest";
import { PageCustomizationController } from "../../src/content/page-customization-controller.js";
import * as storageClient from "../../src/content/storage-client.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { createStyleOperation } from "../editor/fixtures.js";
import type { EditorOperation, MoveOperation } from "../../src/editor/operations.js";

function styleColorOperation(value: string): EditorOperation {
  return createStyleOperation({
    id: `op-style-${value}`,
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
    payload: { property: "color", value },
  });
}

/**
 * A move that promotes its target into a managed, detached layer reparented to
 * <body> (the same managed-wrapper machinery used by clones and lasso moves).
 */
function detachedMoveOperation(): MoveOperation {
  return {
    id: "op-move-detached",
    type: "move",
    pageKey: "https://example.com/",
    target: {
      nodeId: "node-2",
      signature: {
        cssPath: "main p#box",
        tagName: "p",
        classList: [],
        idAttr: "box",
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
    },
    payload: {
      dx: 120,
      dy: 80,
      detached: true,
      detachedLeft: 200,
      detachedTop: 160,
    },
    createdAt: 1,
    source: "manual",
    status: "approved",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("clear-all vs stale replay generation guard", () => {
  it("does not mutate the DOM when clear lands while replay is still pending", async () => {
    const { document, root } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const copy = root.querySelector("#copy") as HTMLElement;
    const operation = styleColorOperation("rgb(255, 0, 0)");

    // Hold the storage read open so clear can interleave mid-replay.
    let resolveLoad!: (operations: EditorOperation[]) => void;
    const pendingLoad = new Promise<EditorOperation[]>((resolve) => {
      resolveLoad = resolve;
    });
    vi.spyOn(storageClient, "loadPageOperations").mockReturnValue(pendingLoad);
    vi.spyOn(storageClient, "clearPageOperations").mockResolvedValue(true);

    const controller = new PageCustomizationController(document);
    const replaySpy = vi.spyOn(controller.getAdapter(), "replayOperationsWithDiagnostics");

    const replayResult = controller.ensureReplayed();

    // Clear runs and fully resets live state while replay is parked on the load.
    await controller.clearPage();

    // Stale operations finally arrive; the resumed replay must become a no-op.
    resolveLoad([operation]);
    await replayResult;

    expect(replaySpy).not.toHaveBeenCalled();
    expect(copy.style.color).toBe("");
    expect(controller.getPageOperations()).toEqual([]);
  });

  it("removes managed layers and effect-registry state on clear", async () => {
    const { document, root } = createTestDocument(
      `<main><p id="copy">Hello</p><p id="box">Box</p></main>`,
    );
    const copy = root.querySelector("#copy") as HTMLElement;
    const box = root.querySelector("#box") as HTMLElement;
    vi.spyOn(storageClient, "clearPageOperations").mockResolvedValue(true);

    const controller = new PageCustomizationController(document);
    const adapter = controller.getAdapter();

    const style = styleColorOperation("rgb(0, 128, 0)");
    const detachedMove = detachedMoveOperation();

    expect(adapter.applyOperation(style).ok).toBe(true);
    expect(adapter.applyOperation(detachedMove).ok).toBe(true);
    controller.setPageOperations([style, detachedMove]);

    // The moved element is promoted into a managed, detached layer on <body>.
    expect(copy.style.color).toBe("rgb(0, 128, 0)");
    expect(box.getAttribute("data-otf-managed")).toBe("true");
    expect(box.getAttribute("data-otf-detached")).toBe("true");
    expect(box.parentElement).toBe(document.body);
    // Effect registry is populated: re-applying the same id is rejected.
    const duplicateApply = adapter.applyOperation(style);
    expect(duplicateApply.ok).toBe(false);
    expect(duplicateApply.ok === false && duplicateApply.code).toBe(
      "operation_already_applied",
    );

    await controller.clearPage();

    // Live mutations and managed wrappers are gone, elements are back in place.
    expect(copy.style.color).toBe("");
    expect(box.getAttribute("data-otf-managed")).toBeNull();
    expect(box.getAttribute("data-otf-detached")).toBeNull();
    expect(document.querySelector("[data-otf-managed]")).toBeNull();
    expect(document.querySelector("[data-otf-detached]")).toBeNull();
    expect(controller.getPageOperations()).toEqual([]);
    // Registry state was cleared, so the operation id is free to apply again.
    expect(adapter.applyOperation(style).ok).toBe(true);
  });

  it("replays nothing after clear when persisted operations are gone (refresh)", async () => {
    const { document, root } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const copy = root.querySelector("#copy") as HTMLElement;
    const operation = styleColorOperation("rgb(0, 0, 255)");

    // Backing store that clear actually empties.
    let stored: EditorOperation[] = [operation];
    vi.spyOn(storageClient, "loadPageOperations").mockImplementation(async () => [...stored]);
    vi.spyOn(storageClient, "clearPageOperations").mockImplementation(async () => {
      stored = [];
      return true;
    });

    const firstLoad = new PageCustomizationController(document);
    await firstLoad.ensureReplayed();
    expect(copy.style.color).toBe("rgb(0, 0, 255)");

    await firstLoad.clearPage();
    expect(copy.style.color).toBe("");
    expect(stored).toEqual([]);

    // Simulate a refresh: a brand-new controller replays from now-empty storage.
    const afterRefresh = new PageCustomizationController(document);
    const replaySpy = vi.spyOn(afterRefresh.getAdapter(), "replayOperationsWithDiagnostics");
    const result = await afterRefresh.ensureReplayed();

    expect(result.count).toBe(0);
    expect(replaySpy).not.toHaveBeenCalled();
    expect(copy.style.color).toBe("");
    expect(afterRefresh.getPageOperations()).toEqual([]);
  });
});
