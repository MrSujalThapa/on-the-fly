import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { OperationStore } from "../../src/background/storage/operation-store.js";
import {
  handleExportData,
  handleImportData,
  setOperationStore,
} from "../../src/background/storage/storage-gateway.js";
import { OTF_EXPORT_SCHEMA_VERSION } from "../../src/shared/export-import.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import type { MoveOperation } from "../../src/editor/operations.js";

const PAGE_KEY = "https://example.com/pricing";

function moveOp(id: string): MoveOperation {
  return {
    id,
    type: "move",
    pageKey: PAGE_KEY,
    target: {
      nodeId: id,
      signature: {
        cssPath: "main p.intro",
        tagName: "p",
        classList: ["intro"],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
    },
    payload: { dx: 3, dy: 4 },
    createdAt: 1,
    source: "manual",
    status: "approved",
  };
}

describe("export/import gateway", () => {
  afterEach(() => {
    setOperationStore(null);
  });

  it("exports and imports saved operations", async () => {
    const store = new OperationStore({ indexedDB: new IDBFactory() });
    setOperationStore(store);
    await store.saveOperations(PAGE_KEY, [moveOp("op-1")]);

    const exported = await handleExportData();
    expect(exported.ok).toBe(true);
    expect(exported.json).toContain("op-1");

    await store.clearPage(PAGE_KEY);
    expect((await store.loadOperations(PAGE_KEY)).length).toBe(0);

    const imported = await handleImportData(exported.json);
    expect(imported.ok).toBe(true);
    expect((await store.loadOperations(PAGE_KEY)).map((op) => op.id)).toEqual(["op-1"]);
  });

  it("rejects invalid import payloads with a friendly message", async () => {
    setOperationStore(new OperationStore({ indexedDB: new IDBFactory() }));
    const imported = await handleImportData(
      JSON.stringify({ schemaVersion: OTF_EXPORT_SCHEMA_VERSION - 1 }),
    );
    expect(imported.ok).toBe(false);
    expect(imported.userMessage).toBeTruthy();
  });
});
