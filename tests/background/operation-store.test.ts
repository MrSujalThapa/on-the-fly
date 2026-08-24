import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { OperationStore } from "../../src/background/storage/operation-store.js";
import { DomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import type {
  HideOperation,
  MoveOperation,
  StyleOperation,
} from "../../src/editor/operations.js";
import { createTestDocument } from "../editor/dom/test-document.js";

const PAGE_KEY = "https://example.com/pricing";
const OTHER_PAGE_KEY = "https://example.com/about";

function createStore(): OperationStore {
  // A fresh IDBFactory per test guarantees isolation between cases.
  return new OperationStore({ indexedDB: new IDBFactory(), now: () => 1_700_000_000_000 });
}

function targetFor(cssPath: string, tagName: string, classList: string[]) {
  return {
    nodeId: cssPath,
    signature: {
      cssPath,
      tagName,
      classList,
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
  };
}

function moveOp(id: string, dx: number, dy: number, pageKey = PAGE_KEY): MoveOperation {
  return {
    id,
    type: "move",
    pageKey,
    target: targetFor("main p.intro", "p", ["intro"]),
    payload: { dx, dy },
    createdAt: 1,
    source: "manual",
    status: "approved",
  };
}

function hideOp(id: string, pageKey = PAGE_KEY): HideOperation {
  return {
    id,
    type: "hide",
    pageKey,
    target: targetFor("main p.intro", "p", ["intro"]),
    payload: { hidden: true },
    createdAt: 2,
    source: "manual",
    status: "approved",
  };
}

describe("OperationStore", () => {
  it("saves and loads operations in deterministic sequence order", async () => {
    const store = createStore();
    await store.saveOperations(PAGE_KEY, [moveOp("op-1", 10, 0)]);
    await store.saveOperations(PAGE_KEY, [moveOp("op-2", 0, 20), hideOp("op-3")]);

    const loaded = await store.loadOperations(PAGE_KEY);
    expect(loaded.map((op) => op.id)).toEqual(["op-1", "op-2", "op-3"]);
    // Storage-only fields are stripped from the returned operations.
    expect(loaded[0]).not.toHaveProperty("sequence");
    expect(loaded[0]).not.toHaveProperty("customizationId");
  });

  it("scopes operations by page key", async () => {
    const store = createStore();
    await store.saveOperations(PAGE_KEY, [moveOp("op-1", 5, 5)]);
    await store.saveOperations(OTHER_PAGE_KEY, [moveOp("op-2", 7, 7, OTHER_PAGE_KEY)]);

    expect((await store.loadOperations(PAGE_KEY)).map((op) => op.id)).toEqual(["op-1"]);
    expect((await store.loadOperations(OTHER_PAGE_KEY)).map((op) => op.id)).toEqual(["op-2"]);
  });

  it("skips invalid operations on save", async () => {
    const store = createStore();
    const invalid = { ...moveOp("bad", 1, 1), type: "frobnicate" } as unknown as MoveOperation;
    const saved = await store.saveOperations(PAGE_KEY, [invalid, moveOp("good", 1, 1)]);

    expect(saved.saved).toBe(1);
    expect(saved.skipped).toBe(1);
    expect((await store.loadOperations(PAGE_KEY)).map((op) => op.id)).toEqual(["good"]);
  });

  it("does not persist draft operations through the save path", async () => {
    const store = createStore();
    const draft = { ...moveOp("draft", 1, 1), status: "draft" as const };
    const saved = await store.saveOperations(PAGE_KEY, [draft]);

    expect(saved.saved).toBe(0);
    expect(saved.skipped).toBe(1);
    expect(await store.loadOperations(PAGE_KEY)).toEqual([]);
  });

  it("does not persist preview operations through the save path", async () => {
    const store = createStore();
    const preview = { ...moveOp("preview", 1, 1), status: "preview" as const };
    const saved = await store.saveOperations(PAGE_KEY, [preview]);

    expect(saved.saved).toBe(0);
    expect(saved.skipped).toBe(1);
    expect(await store.loadOperations(PAGE_KEY)).toEqual([]);
  });

  it("replaces and reloads createElement operations", async () => {
    const store = createStore();
    const operation = {
      id: "create-1",
      type: "createElement" as const,
      pageKey: PAGE_KEY,
      target: {
        nodeId: "el-1",
        signature: {
          cssPath: '[data-otf-element-id="el-1"]',
          tagName: "button",
          classList: [],
          datasetFingerprint: "otfElementId=el-1",
          boundingBoxHint: createEmptyBoundingBoxHint(),
          identityVersion: 2,
        },
      },
      payload: {
        elementId: "el-1",
        kind: "button" as const,
        rect: { x: 8, y: 8, width: 120, height: 40 },
        content: { text: "Button" },
        appearance: { fill: "#ffffff" },
      },
      createdAt: 1,
      source: "manual" as const,
      status: "approved" as const,
    };
    await store.replacePageOperations(PAGE_KEY, [operation]);
    const loaded = await store.loadOperations(PAGE_KEY);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.type).toBe("createElement");
    if (loaded[0]?.type !== "createElement") return;
    expect(loaded[0].payload.elementId).toBe("el-1");
  });

  it("rejects an invalid replacement without changing the acknowledged checkpoint", async () => {
    const store = createStore();
    await store.replacePageOperations(PAGE_KEY, [moveOp("acknowledged", 1, 1)]);
    await expect(store.replacePageOperations(PAGE_KEY, [
      { ...moveOp("draft", 1, 1), status: "draft" as const },
      moveOp("replacement", 1, 1),
    ])).rejects.toThrow("invalid_checkpoint_operation:draft:draft");

    expect((await store.loadOperations(PAGE_KEY)).map((op) => op.id)).toEqual(["acknowledged"]);
  });

  it("coalesces repeated hide operations for the same target", async () => {
    const store = createStore();
    await store.saveOperations(PAGE_KEY, [hideOp("hide-1")]);
    const second = await store.saveOperations(PAGE_KEY, [hideOp("hide-2")]);

    expect(second.saved).toBe(0);
    expect(second.skipped).toBe(1);
    expect((await store.loadOperations(PAGE_KEY)).map((op) => op.id)).toEqual(["hide-1"]);
  });

  it("keeps hide operations for different targets", async () => {
    const store = createStore();
    const hideA = hideOp("hide-a");
    const hideB: HideOperation = {
      ...hideOp("hide-b"),
      target: targetFor("main p.other", "p", ["other"]),
    };

    await store.saveOperations(PAGE_KEY, [hideA]);
    await store.saveOperations(PAGE_KEY, [hideB]);

    expect((await store.loadOperations(PAGE_KEY)).map((op) => op.id)).toEqual(["hide-a", "hide-b"]);
  });

  it("reports cap trimming with a clear capReached flag", async () => {
    const store = new OperationStore({
      indexedDB: new IDBFactory(),
      now: () => 1,
    });
    const ops = Array.from({ length: 1002 }, (_, index) => moveOp(`op-${String(index)}`, index, 0));
    const result = await store.saveOperations(PAGE_KEY, ops);

    expect(result.capReached).toBe(true);
    expect(result.trimmed).toBe(2);
    expect(result.totalCount).toBe(1000);
    expect(await store.countOperations(PAGE_KEY)).toBe(1000);
  });

  it("clears all operations for a page without affecting others", async () => {
    const store = createStore();
    await store.saveOperations(PAGE_KEY, [moveOp("op-1", 1, 1)]);
    await store.saveOperations(OTHER_PAGE_KEY, [moveOp("op-2", 2, 2, OTHER_PAGE_KEY)]);

    const removed = await store.clearPage(PAGE_KEY);
    expect(removed).toBe(1);
    expect(await store.loadOperations(PAGE_KEY)).toEqual([]);
    expect((await store.loadOperations(OTHER_PAGE_KEY)).map((op) => op.id)).toEqual(["op-2"]);
  });

  it("persists across store instances backed by the same database", async () => {
    const factory = new IDBFactory();
    const first = new OperationStore({ indexedDB: factory, dbName: "otf_test" });
    await first.saveOperations(PAGE_KEY, [moveOp("op-1", 3, 4)]);
    first.close();

    const second = new OperationStore({ indexedDB: factory, dbName: "otf_test" });
    const loaded = await second.loadOperations(PAGE_KEY);
    expect(loaded.map((op) => op.id)).toEqual(["op-1"]);
  });

  it("loads saved operations and replays them onto the DOM in order", async () => {
    const store = createStore();
    const styleOp: StyleOperation = {
      id: "op-style",
      type: "style",
      pageKey: PAGE_KEY,
      target: targetFor("main p.intro", "p", ["intro"]),
      payload: { property: "color", value: "rgb(0, 128, 0)" },
      createdAt: 1,
      source: "manual",
      status: "approved",
    };
    await store.saveOperations(PAGE_KEY, [styleOp, moveOp("op-move", 12, 16)]);

    const { root } = createTestDocument(`<main><p class="intro">Hello</p></main>`);
    const adapter = new DomRuntimeAdapter(root);
    const operations = await store.loadOperations(PAGE_KEY);
    const results = adapter.replayOperations(operations);

    expect(results.every((result) => result.ok)).toBe(true);
    const paragraph = root.querySelector("p.intro") as HTMLElement;
    expect(paragraph.style.color).toBe("rgb(0, 128, 0)");
    expect(paragraph.style.transform).toContain("translate(12px, 16px)");
  });
});
