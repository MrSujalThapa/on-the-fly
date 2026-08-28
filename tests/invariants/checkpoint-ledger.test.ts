import { describe, expect, it } from "vitest";
import type { DuplicateOperation, EditorOperation, MoveOperation, ZIndexOperation } from "../../src/editor/operations.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import { createOperationLedger } from "../../src/runtime-v2/create-operation-ledger.js";
import { durableMoveKey, projectCanonicalCheckpoint } from "../../src/runtime-v2/canonical-checkpoint.js";

function move(id: string, nodeKey: string, dx: number, originalX: number, finalX: number): MoveOperation {
  return {
    id: `op-${id}`,
    type: "move",
    pageKey: "https://example.com/",
    target: {
      signature: {
        cssPath: `button:nth-of-type(${nodeKey})`,
        tagName: "button",
        classList: ["tab"],
        textFingerprint: nodeKey,
        boundingBoxHint: createEmptyBoundingBoxHint(),
        identityVersion: 2,
      },
    },
    payload: { dx, dy: 0 },
    createdAt: 1,
    source: "manual",
    status: "approved",
    metadata: {
      originalRect: { x: originalX, y: 10, width: 40, height: 20 },
      finalRect: { x: finalX, y: 10, width: 40, height: 20 },
      affectedRect: { x: finalX, y: 10, width: 40, height: 20 },
    },
  };
}

function layer(id: string, nodeKey: string, value: number): ZIndexOperation {
  return {
    id: `layer-${id}`,
    type: "zIndex",
    pageKey: "https://example.com/",
    target: move(id, nodeKey, 0, 0, 0).target,
    payload: { layer: value, previousLayer: 0 },
    createdAt: Number(id),
    source: "manual",
    status: "approved",
    metadata: { sourceCommand: value > 0 ? "layer:front" : "layer:back" },
  };
}

function duplicate(cloneId: string): DuplicateOperation {
  return {
    id: `create-${cloneId}`,
    type: "duplicate",
    pageKey: "https://example.com/",
    target: {
      nodeId: cloneId,
      signature: {
        cssPath: `[data-otf-clone-id="${cloneId}"]`,
        tagName: "h1",
        classList: ["title"],
        textFingerprint: "Manage notifications",
        datasetFingerprint: `otfCloneId=${cloneId}`,
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
    },
    payload: {
      cloneId,
      html: '<h1 class="title">Manage notifications</h1>',
      parentCssPath: "body",
      offsetDx: 12,
      offsetDy: 12,
      sourceCssPath: "aside h1",
      anchorLeft: 10,
      anchorTop: 20,
      anchorWidth: 200,
      anchorHeight: 40,
      styleSnapshot: {},
    },
    createdAt: 1,
    source: "manual",
    status: "approved",
  };
}

function cloneMove(cloneId: string, dx: number): MoveOperation {
  const operation = move(cloneId, "Manage notifications", dx, 10, 10 + dx);
  operation.target = duplicate(cloneId).target;
  return operation;
}

function ledgerMove(id: string): MoveOperation {
  return {
    id,
    type: "move",
    pageKey: "https://example.com/",
    target: {
      signature: {
        cssPath: "article",
        tagName: "article",
        classList: [],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
    },
    payload: { dx: 10, dy: 0 },
    createdAt: 1,
    source: "manual",
    status: "draft",
  };
}

describe("canonical checkpoint", () => {
  it("compacts historical moves per durable target and keeps independent targets apart", () => {
    const compacted = projectCanonicalCheckpoint([
      move("1", "mentions", 20, 0, 20),
      move("2", "mentions", 40, 20, 60),
      move("3", "mentions", -15, 60, 45),
    ]);
    expect(compacted.ok).toBe(true);
    if (!compacted.ok) return;
    expect(compacted.operations).toHaveLength(1);
    expect(compacted.operations[0]?.type === "move" && compacted.operations[0].payload.dx).toBe(45);
    expect(compacted.operations[0]?.type === "move" && compacted.operations[0].metadata?.originalRect?.x).toBe(0);
    expect(durableMoveKey(compacted.operations[0] as MoveOperation)).toBe(durableMoveKey(move("1", "mentions", 20, 0, 20)));

    const split = projectCanonicalCheckpoint([
      move("1", "b", 20, 0, 20),
      move("2", "c", 10, 0, 10),
      move("3", "b", 15, 20, 35),
    ]);
    expect(split.ok && split.operations).toHaveLength(2);
  });

  it("compacts the same control across generated ids and attached→detached structure changes", () => {
    const first = move("1", "Mentions", 40, 0, 40);
    const second = move("2", "Mentions", 32, 40, 72);
    if (first.target.signature && second.target.signature) {
      first.target.signature.idAttr = "ember123";
      first.target.signature.datasetFingerprint = "id=ember123";
      first.target.signature.role = "radio";
      first.target.signature.siblingOrdinal = 4;
      first.target.signature.siblingCount = 4;
      second.target.signature.idAttr = "ember999";
      second.target.signature.datasetFingerprint = "id=ember999";
      second.target.signature.role = "radio";
      second.target.signature.siblingOrdinal = 4;
      second.target.signature.siblingCount = 4;
    }
    const generated = projectCanonicalCheckpoint([first, second]);
    expect(generated.ok && generated.operations).toHaveLength(1);

    const attached = move("1", "My posts", 120, 0, 120);
    const detached = move("2", "My posts", 40, 120, 160);
    attached.target.nodeId = "otf-vn-posts";
    detached.target.nodeId = "otf-vn-posts";
    if (attached.target.signature && detached.target.signature) {
      attached.target.signature.parentFingerprint = "div.filters";
      detached.target.signature.cssPath = "body > button[data-otf-detached]";
      detached.target.signature.parentFingerprint = "body";
    }
    const continuous = projectCanonicalCheckpoint([attached, detached]);
    expect(continuous.ok && continuous.operations).toHaveLength(1);
    expect(continuous.ok && continuous.operations[0]?.type === "move" && continuous.operations[0].payload.dx).toBe(160);
  });

  it("keeps compacted MOVE finalRect on the live AABB when a ROTATE is also present", () => {
    const moved = move("1", "mentions", 40, 10, 50);
    moved.payload.detached = true;
    moved.payload.detachedWidth = 40;
    moved.payload.detachedHeight = 20;
    if (moved.metadata) {
      moved.metadata.finalRect = { x: 50, y: 10, width: 80, height: 60 };
      moved.metadata.affectedRect = { x: 50, y: 10, width: 80, height: 60 };
    }
    const rotated: EditorOperation = {
      id: "op-rotate",
      type: "rotate",
      pageKey: "https://example.com/",
      target: moved.target,
      payload: { degrees: 45, previousDegrees: 0 },
      createdAt: 2,
      source: "manual",
      status: "approved",
      metadata: {
        originalRect: { x: 10, y: 10, width: 40, height: 20 },
        finalRect: { x: 50, y: 10, width: 80, height: 60 },
        affectedRect: { x: 50, y: 10, width: 80, height: 60 },
      },
    };
    const compacted = projectCanonicalCheckpoint([moved, rotated]);
    expect(compacted.ok).toBe(true);
    if (!compacted.ok) return;
    const result = compacted.operations.find((operation) => operation.type === "move");
    expect(result?.type === "move" && result.metadata?.finalRect).toEqual({ x: 50, y: 10, width: 80, height: 60 });
    expect(result?.type === "move" && result.payload.detachedWidth).toBe(40);
    expect(result?.type === "move" && result.payload.detachedHeight).toBe(20);
  });

  it("keeps compacted MOVE origin on the last visual AABB after a later rotated resize", () => {
    const first = move("1", "alpha", 30, 10, 40);
    first.payload.detached = true;
    first.payload.detachedWidth = 40;
    first.payload.detachedHeight = 20;
    first.target.nodeId = "otf-vn-alpha";
    const second = move("2", "alpha", 84, 40, 155);
    second.payload.detached = true;
    second.target.nodeId = "otf-vn-alpha";
    if (second.metadata) {
      second.metadata.finalRect = { x: 155, y: 92, width: 90, height: 104 };
      second.metadata.affectedRect = { x: 155, y: 92, width: 90, height: 104 };
    }
    const effect = (id: string, type: "resize" | "rotate", payload: object, rect: { x: number; y: number; width: number; height: number }): EditorOperation => ({
      id,
      type,
      pageKey: "https://example.com/",
      target: first.target,
      payload,
      createdAt: 1,
      source: "manual",
      status: "approved",
      metadata: { originalRect: rect, finalRect: rect, affectedRect: rect },
    } as EditorOperation);
    const compacted = projectCanonicalCheckpoint([
      first,
      effect("resize-1", "resize", { width: 60, height: 30, mode: "box" }, { x: 40, y: 10, width: 60, height: 30 }),
      effect("rotate-1", "rotate", { degrees: 45, previousDegrees: 0 }, { x: 30, y: 5, width: 80, height: 60 }),
      second,
      effect("resize-2", "resize", { width: 108, height: 105, mode: "box" }, { x: 116, y: 80, width: 147, height: 148 }),
    ]);
    expect(compacted.ok).toBe(true);
    if (!compacted.ok) return;
    const moved = compacted.operations.find((operation) => operation.type === "move");
    expect(moved?.type === "move" && moved.metadata?.finalRect).toEqual({ x: 116, y: 80, width: 147, height: 148 });
    expect(moved?.type === "move" && moved.payload.detachedWidth).toBe(108);
    expect(moved?.type === "move" && moved.payload.detachedHeight).toBe(105);
    const reprojected = projectCanonicalCheckpoint(compacted.operations);
    expect(reprojected.ok && reprojected.operations.find((operation) => operation.type === "move")?.metadata?.finalRect)
      .toEqual({ x: 116, y: 80, width: 147, height: 148 });
  });

  it("fails closed on durable-key collisions and missing clone creation", () => {
    const first = move("1", "Duplicate", 20, 0, 20);
    const second = move("2", "Duplicate", 30, 0, 30);
    first.target.nodeId = "otf-vn-first";
    second.target.nodeId = "otf-vn-second";
    if (first.target.signature && second.target.signature) {
      first.target.signature.role = "radio";
      first.target.signature.parentFingerprint = "div.filters";
      first.target.signature.siblingOrdinal = 1;
      first.target.signature.siblingCount = 2;
      second.target.signature.role = "radio";
      second.target.signature.parentFingerprint = "div.filters";
      second.target.signature.siblingOrdinal = 2;
      second.target.signature.siblingCount = 2;
    }
    const collision = projectCanonicalCheckpoint([first, second]);
    expect(collision.ok).toBe(false);

    expect(projectCanonicalCheckpoint([cloneMove("clone-a", 20)]).ok).toBe(false);
    expect(projectCanonicalCheckpoint([duplicate("clone-a"), duplicate("clone-a")]).ok).toBe(false);
  });

  it("compacts layer and style independently and keeps clone effects in dependency order", () => {
    const layers = projectCanonicalCheckpoint([
      layer("1", "mentions", 10),
      layer("2", "mentions", 0),
      layer("3", "mentions", 20),
    ]);
    expect(layers.ok && layers.operations[0]?.type === "zIndex" && layers.operations[0].payload.layer).toBe(20);

    const target = duplicate("clone-a").target;
    const effect = (type: EditorOperation["type"], payload: object, id: string): EditorOperation => ({
      ...cloneMove("clone-a", 20), id, type, target, payload,
    } as EditorOperation);
    const ordered = projectCanonicalCheckpoint([
      effect("hide", { hidden: true }, "hide"),
      effect("rotate", { degrees: 25 }, "rotate"),
      duplicate("clone-a"),
      effect("zIndex", { layer: 8, previousLayer: 1 }, "layer"),
      cloneMove("clone-a", 20),
      effect("resize", { width: 240, height: 60, mode: "box" }, "resize"),
    ]);
    expect(ordered.ok && ordered.operations.map((operation) => operation.type)).toEqual([
      "duplicate", "move", "resize", "rotate", "zIndex", "hide",
    ]);
  });
});

describe("operation ledger", () => {
  it("derives active operations, undo/redo, and dirty from one cursor", () => {
    const ledger = createOperationLedger();
    ledger.commit(ledgerMove("a"));
    ledger.commit(ledgerMove("b"));
    expect(ledger.activeOperations().map((operation) => operation.id)).toEqual(["a", "b"]);
    ledger.markPersisted();
    expect(ledger.confirmUndo()?.id).toBe("b");
    expect(ledger.isDirty()).toBe(true);
    expect(ledger.confirmRedo()?.id).toBe("b");
    expect(ledger.isDirty()).toBe(false);
  });

  it("truncates redo, tracks in-flight persist, and undoes a committed batch as one transaction", () => {
    const ledger = createOperationLedger();
    ledger.commit(ledgerMove("a"));
    ledger.commit(ledgerMove("b"));
    ledger.confirmUndo();
    ledger.commit(ledgerMove("c"));
    expect(ledger.activeOperations().map((operation) => operation.id)).toEqual(["a", "c"]);
    expect(ledger.canRedo()).toBe(false);

    const saving = createOperationLedger();
    saving.commit(ledgerMove("save-a"));
    const revision = saving.cursor;
    saving.commit(ledgerMove("edit-b"));
    saving.markPersisted(revision);
    expect(saving.isDirty()).toBe(true);

    const batch = createOperationLedger();
    batch.commitBatch([ledgerMove("a"), ledgerMove("b"), ledgerMove("c")]);
    batch.confirmUndoTransaction();
    expect(batch.activeOperations()).toEqual([]);
    batch.confirmRedoTransaction();
    expect(batch.activeOperations()).toHaveLength(3);
  });
});
