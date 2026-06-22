import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { OperationStore } from "../../src/background/storage/operation-store.js";
import {
  handleClearPage,
  handleGetPageOperationCount,
  handleLoadPageState,
  handleSaveOperations,
  setOperationStore,
} from "../../src/background/storage/storage-gateway.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import type { MoveOperation } from "../../src/editor/operations.js";

const PAGE_KEY = "https://example.com/dashboard";

function moveOp(id: string): MoveOperation {
  return {
    id,
    type: "move",
    pageKey: PAGE_KEY,
    target: {
      nodeId: id,
      signature: {
        cssPath: "main .widget",
        tagName: "div",
        classList: ["widget"],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
    },
    payload: { dx: 4, dy: 8 },
    createdAt: 1,
    source: "manual",
    status: "approved",
  };
}

describe("storage gateway message handlers", () => {
  afterEach(() => {
    setOperationStore(null);
  });

  it("saves, loads, and clears via the gateway against a fake IndexedDB", async () => {
    setOperationStore(new OperationStore({ indexedDB: new IDBFactory() }));

    const saved = await handleSaveOperations(PAGE_KEY, [moveOp("op-1"), moveOp("op-2")]);
    expect(saved.ok).toBe(true);
    expect(saved.operationCount).toBe(2);

    const loaded = await handleLoadPageState(PAGE_KEY);
    expect(loaded.ok).toBe(true);
    expect(loaded.operationCount).toBe(2);
    expect(loaded.operations?.map((op) => op.id)).toEqual(["op-1", "op-2"]);

    const count = await handleGetPageOperationCount(PAGE_KEY);
    expect(count.ok).toBe(true);
    expect(count.operationCount).toBe(2);

    const cleared = await handleClearPage(PAGE_KEY);
    expect(cleared.ok).toBe(true);

    const afterClear = await handleLoadPageState(PAGE_KEY);
    expect(afterClear.operations).toEqual([]);
  });
});
