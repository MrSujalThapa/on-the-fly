import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { OperationStore } from "../../src/background/storage/operation-store.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import type { HideOperation, MoveOperation, StyleOperation } from "../../src/editor/operations.js";
import { validateOperation } from "../../src/editor/validation/validate-operation.js";

const PAGE_KEY = "https://example.com/pricing";

function target() {
  return {
    nodeId: "node-1",
    signature: {
      cssPath: "main article p.intro",
      tagName: "p",
      classList: ["intro"],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
  };
}

function style(overrides: Partial<StyleOperation> = {}): StyleOperation {
  return {
    id: "op-style-1",
    type: "style",
    pageKey: PAGE_KEY,
    target: target(),
    payload: { property: "color", value: "rgb(0, 0, 0)" },
    createdAt: 1,
    source: "manual",
    status: "approved",
    ...overrides,
  };
}

function move(id: string, pageKey = PAGE_KEY): MoveOperation {
  return {
    id,
    type: "move",
    pageKey,
    target: target(),
    payload: { dx: 10, dy: 0 },
    createdAt: 1,
    source: "manual",
    status: "approved",
  };
}

function hide(id: string): HideOperation {
  return {
    id,
    type: "hide",
    pageKey: PAGE_KEY,
    target: target(),
    payload: { hidden: true },
    createdAt: 2,
    source: "manual",
    status: "approved",
  };
}

describe("operation validation", () => {
  it("accepts a valid style operation and rejects dangerous, unknown, and incomplete payloads", () => {
    expect(validateOperation(style()).ok).toBe(true);
    expect(validateOperation(style({
      target: { nodeId: "node-danger", signature: { ...target().signature, cssPath: "body", tagName: "body" } },
    })).ok).toBe(false);
    expect(validateOperation({ ...style(), type: "unknown" } as unknown as StyleOperation).ok).toBe(false);
    expect(validateOperation(style({ target: {} })).ok).toBe(false);
    expect(validateOperation({
      ...style(),
      payload: { property: "not-a-style-prop", value: "red" },
    } as unknown as StyleOperation).ok).toBe(false);
  });
});

describe("operation store", () => {
  it("saves and loads operations in deterministic sequence order, scoped by page key", async () => {
    const store = new OperationStore({ indexedDB: new IDBFactory(), now: () => 1_700_000_000_000 });
    await store.saveOperations(PAGE_KEY, [move("op-1")]);
    await store.saveOperations(PAGE_KEY, [move("op-2"), hide("op-3")]);
    await store.saveOperations("https://example.com/about", [move("other", "https://example.com/about")]);
    const loaded = await store.loadOperations(PAGE_KEY);
    expect(loaded.map((operation) => operation.id)).toEqual(["op-1", "op-2", "op-3"]);
    expect(loaded[0]).not.toHaveProperty("sequence");
    expect((await store.loadOperations("https://example.com/about")).map((operation) => operation.id)).toEqual(["other"]);
  });
});
