import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { OperationStore } from "../../../src/background/storage/operation-store.js";
import { PageCustomizationController } from "../../../src/content/page-customization-controller.js";
import {
  appendDraftOperations,
  createSessionOperationState,
  promoteAllDraftToSaved,
} from "../../../src/content/session-operation-state.js";
import { DomRuntimeAdapter } from "../../../src/editor/dom/dom-runtime-adapter.js";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import { buildPersistableElementSignature } from "../../../src/editor/measurement/signature-builder.js";
import {
  coalescePageOperations,
  keepLatestZIndexOperations,
} from "../../../src/editor/persistence/coalesce-page-operations.js";
import { FRONT_LAYER, BACK_LAYER } from "../../../src/editor/transform/layer-order.js";
import { buildZIndexOperation } from "../../../src/editor/transform/operation-factory.js";
import type { TransformTarget } from "../../../src/editor/transform/transform-target.js";
import type { ZIndexOperation } from "../../../src/editor/operations.js";
import { validateOperation } from "../../../src/editor/validation/validate-operation.js";
import { createInsertHelperObjectOperation } from "../fixtures.js";
import { createTestDocument } from "../dom/test-document.js";
import { OTF_HELPER_ATTR } from "../../../src/editor/dom/types.js";
import { layoutElement } from "../measurement/layout-helpers.js";
import * as storageClient from "../../../src/content/storage-client.js";

const PAGE_KEY = "https://example.com/";

function targetFor(cssPath: string, className: string): TransformTarget {
  return {
    nodeId: className,
    signature: {
      cssPath,
      tagName: "div",
      classList: [className],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
    rect: { x: 20, y: 20, width: 100, height: 40 },
  };
}

function zIndexOp(
  id: string,
  layer: number,
  previousLayer?: number,
  cssPath = "main div.box-a",
): ZIndexOperation {
  return {
    id,
    type: "zIndex",
    pageKey: PAGE_KEY,
    target: {
      nodeId: "box-a",
      signature: {
        cssPath,
        tagName: "div",
        classList: ["box-a"],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
    },
    payload: previousLayer === undefined ? { layer } : { layer, previousLayer },
    createdAt: 1,
    source: "manual",
    status: "approved",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("zIndex persistence and replay", () => {
  it("validates front/back layer values for storage", () => {
    for (const op of [
      zIndexOp("z-back", BACK_LAYER, 1),
      zIndexOp("z-front", FRONT_LAYER, BACK_LAYER),
    ]) {
      const result = validateOperation(op);
      expect(result.ok, result.errors.join("; ")).toBe(true);
    }
  });

  it("persists zIndex ops as approved through replace", async () => {
    const store = new OperationStore({ indexedDB: new IDBFactory() });
    const ops = [zIndexOp("z1", BACK_LAYER, 1), zIndexOp("z2", FRONT_LAYER, BACK_LAYER)];

    await store.replacePageOperations(PAGE_KEY, ops);
    const loaded = await store.loadOperations(PAGE_KEY);

    expect(loaded.every((operation) => operation.status === "approved")).toBe(true);
    expect(loaded.some((operation) => operation.id === "z2")).toBe(true);
  });

  it("replays zIndex ops in sequence so the latest layer wins", () => {
    const { root } = createTestDocument(`<main><div class="box-a">Box A</div></main>`);
    const element = root.querySelector(".box-a") as HTMLElement;
    layoutElement(element, { x: 20, y: 20, width: 100, height: 40 });

    const adapter = new DomRuntimeAdapter(root);
    const ops = [zIndexOp("z1", BACK_LAYER, 1), zIndexOp("z2", FRONT_LAYER, BACK_LAYER)];
    const results = adapter.replayOperations(ops);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(element.style.zIndex).toBe(String(FRONT_LAYER));
  });

  it("replays bring front then send back in saved sequence", () => {
    const { root } = createTestDocument(`<main><div class="box-a">Box A</div></main>`);
    const element = root.querySelector(".box-a") as HTMLElement;
    layoutElement(element, { x: 20, y: 20, width: 100, height: 40 });

    const adapter = new DomRuntimeAdapter(root);
    adapter.replayOperations([
      zIndexOp("z1", FRONT_LAYER, 1),
      zIndexOp("z2", BACK_LAYER, FRONT_LAYER),
    ]);

    expect(element.style.zIndex).toBe(String(BACK_LAYER));
  });

  it("coalesce keeps only the latest zIndex op per target on merge", () => {
    const existing = [zIndexOp("z1", BACK_LAYER, 1)];
    const incoming = [zIndexOp("z2", FRONT_LAYER, BACK_LAYER)];

    const result = coalescePageOperations(existing, incoming);

    expect(result.applied).toBe(1);
    expect(result.operations.map((operation) => operation.id)).toEqual(["z2"]);
  });

  it("promotes the latest draft zIndex as approved and supersedes prior saved zIndex", () => {
    let state = createSessionOperationState([zIndexOp("saved-back", BACK_LAYER, 1)]);
    state = appendDraftOperations(state, [
      { ...zIndexOp("draft-back", BACK_LAYER, 1), status: "draft" },
      { ...zIndexOp("draft-front", FRONT_LAYER, BACK_LAYER), status: "draft" },
    ]);

    state = promoteAllDraftToSaved(state);

    expect(state.savedOperations).toHaveLength(1);
    expect(state.savedOperations[0]?.id).toBe("draft-front");
    expect(state.savedOperations[0]?.status).toBe("approved");
    if (state.savedOperations[0]?.type === "zIndex") {
      expect(state.savedOperations[0].payload.layer).toBe(FRONT_LAYER);
    }
  });

  it("persists latest layer after refresh via page customization replay", async () => {
    const { document, root } = createTestDocument(`<main><div class="box-a">Box A</div></main>`);
    const element = root.querySelector(".box-a") as HTMLElement;
    layoutElement(element, { x: 20, y: 20, width: 100, height: 40 });

    vi.spyOn(storageClient, "loadPageOperations").mockResolvedValue([
      zIndexOp("z-front", FRONT_LAYER, BACK_LAYER),
    ]);

    const controller = new PageCustomizationController(document);
    await controller.ensureReplayed();

    expect(element.style.zIndex).toBe(String(FRONT_LAYER));
  });

  it("clear page reverts zIndex changes", async () => {
    const { document, root } = createTestDocument(`<main><div class="box-a">Box A</div></main>`);
    const element = root.querySelector(".box-a") as HTMLElement;
    layoutElement(element, { x: 20, y: 20, width: 100, height: 40 });

    vi.spyOn(storageClient, "clearPageOperations").mockResolvedValue(true);

    const controller = new PageCustomizationController(document);
    const adapter = controller.getAdapter();
    adapter.applyOperation(zIndexOp("z-front", FRONT_LAYER, 1));
    controller.setPageOperations([zIndexOp("z-front", FRONT_LAYER, 1)]);

    expect(element.style.zIndex).toBe(String(FRONT_LAYER));

    await controller.clearPage();

    expect(element.style.zIndex).toBe("");
    expect(controller.getPageOperations()).toEqual([]);
  });

  it("uses a persistable live-element signature for zIndex operations", () => {
    const { document, root } = createTestDocument(`<main><div class="box-a">Box A</div></main>`);
    const element = root.querySelector(".box-a") as HTMLElement;
    layoutElement(element, { x: 20, y: 20, width: 100, height: 40 });
    element.style.position = "absolute";
    document.body.appendChild(element);

    const staleTarget = targetFor("main div.box-a", "box-a");
    const op = buildZIndexOperation(staleTarget, FRONT_LAYER, 1, { pageKey: PAGE_KEY }, element);

    expect(op.target.signature?.cssPath).toBe(
      buildPersistableElementSignature(element).cssPath,
    );
    expect(validateOperation(op).ok).toBe(true);

    const adapter = new DomRuntimeAdapter(document);
    expect(adapter.applyOperation(op).ok).toBe(true);
    expect(element.style.zIndex).toBe(String(FRONT_LAYER));
  });

  it("helper object zIndex persists after replay", () => {
    const { root } = createTestDocument(`<main><p class="intro">Hello</p></main>`);
    const insert = createInsertHelperObjectOperation({ status: "approved" });
    const layer: ZIndexOperation = {
      id: "op-helper-layer",
      type: "zIndex",
      pageKey: PAGE_KEY,
      target: insert.target,
      payload: { layer: 20 },
      createdAt: 12,
      source: "manual",
      status: "approved",
    };

    const replayAdapter = new DomRuntimeAdapter(root);
    replayAdapter.replayOperations([insert, layer]);

    const helper = root.querySelector(`[${OTF_HELPER_ATTR}="helper-panel-1"]`) as HTMLElement;
    expect(helper.style.zIndex).toBe("20");
  });

  it("keepLatestZIndexOperations preserves non-zIndex ops and latest layer per target", () => {
    const style = {
      id: "style-1",
      type: "style" as const,
      pageKey: PAGE_KEY,
      target: zIndexOp("ignored", 1).target,
      payload: { property: "color" as const, value: "red" },
      createdAt: 1,
      source: "manual" as const,
      status: "approved" as const,
    };

    const compacted = keepLatestZIndexOperations([
      style,
      zIndexOp("z1", BACK_LAYER, 1),
      zIndexOp("z2", FRONT_LAYER, BACK_LAYER),
    ]);

    expect(compacted.map((operation) => operation.id)).toEqual(["style-1", "z2"]);
  });
});
