import { describe, expect, it } from "vitest";
import type { MoveOperation, ZIndexOperation } from "../../src/editor/operations.js";
import { createEmptyBoundingBoxHint } from "../../src/editor/element-signature.js";
import {
  durableMoveKey,
  projectCanonicalCheckpoint,
} from "../../src/runtime-v2/canonical-checkpoint.js";

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
  const target = move(id, nodeKey, 0, 0, 0).target;
  return {
    id: `layer-${id}`,
    type: "zIndex",
    pageKey: "https://example.com/",
    target,
    payload: { layer: value, previousLayer: 0 },
    createdAt: Number(id),
    source: "manual",
    status: "approved",
    metadata: { sourceCommand: value > 0 ? "layer:front" : "layer:back" },
  };
}

describe("canonical MOVE checkpoint", () => {
  it("compacts many historical moves on one target to one final state", () => {
    const history = [
      move("1", "mentions", 20, 0, 20),
      move("2", "mentions", 40, 20, 60),
      move("3", "mentions", -15, 60, 45),
    ];
    const checkpoint = projectCanonicalCheckpoint(history);
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok) {
      return;
    }
    expect(checkpoint.operations).toHaveLength(1);
    const only = checkpoint.operations[0];
    expect(only?.type).toBe("move");
    if (only?.type === "move") {
      expect(only.payload.dx).toBe(45);
      expect(only.metadata?.originalRect?.x).toBe(0);
      expect(only.metadata?.finalRect?.x).toBe(45);
      expect(durableMoveKey(only)).toBe(durableMoveKey(history[0] as MoveOperation));
    }
  });

  it("keeps independent targets separate", () => {
    const checkpoint = projectCanonicalCheckpoint([
      move("1", "b", 20, 0, 20),
      move("2", "c", 10, 0, 10),
      move("3", "b", 15, 20, 35),
    ]);
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok) {
      return;
    }
    expect(checkpoint.operations).toHaveLength(2);
  });

  it("does not fold inherited ancestor movement into a child's local delta", () => {
    const checkpoint = projectCanonicalCheckpoint([
      move("1", "child", 200, 280, 480),
      move("2", "child", -25, 580, 555),
    ]);
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok) {
      return;
    }
    const only = checkpoint.operations[0];
    expect(only?.type).toBe("move");
    if (only?.type === "move") {
      expect(only.payload.dx).toBe(175);
      expect(only.metadata?.finalRect?.x).toBe(555);
    }
  });

  it("compacts the same logical control across generated dataset ids", () => {
    const first = move("1", "Mentions", 40, 0, 40);
    const second = move("2", "Mentions", 32, 40, 72);
    if (first.target.signature) {
      first.target.signature.idAttr = "ember123";
      first.target.signature.datasetFingerprint = "id=ember123";
      first.target.signature.role = "radio";
      first.target.signature.siblingOrdinal = 4;
      first.target.signature.siblingCount = 4;
    }
    if (second.target.signature) {
      second.target.signature.idAttr = "ember999";
      second.target.signature.datasetFingerprint = "id=ember999";
      second.target.signature.role = "radio";
      second.target.signature.siblingOrdinal = 4;
      second.target.signature.siblingCount = 4;
    }
    const checkpoint = projectCanonicalCheckpoint([first, second]);
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok) {
      return;
    }
    expect(checkpoint.operations).toHaveLength(1);
    const only = checkpoint.operations[0];
    if (only?.type === "move") {
      expect(only.payload.dx).toBe(72);
      expect(durableMoveKey(only)).toBe(durableMoveKey(first));
    }
  });

  it("fails closed when distinct targets produce the same durable key", () => {
    const first = move("1", "Duplicate", 20, 0, 20);
    const second = move("2", "Duplicate", 30, 0, 30);
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
    expect(projectCanonicalCheckpoint([first, second])).toEqual({
      ok: false,
      error: "move_durable_identity_collision",
    });
  });

  it("persists only the final layer state per durable target", () => {
    const checkpoint = projectCanonicalCheckpoint([
      layer("1", "mentions", 10),
      layer("2", "mentions", 0),
      layer("3", "mentions", 20),
    ]);
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok) return;
    expect(checkpoint.operations).toHaveLength(1);
    expect(checkpoint.operations[0]?.type).toBe("zIndex");
    if (checkpoint.operations[0]?.type === "zIndex") {
      expect(checkpoint.operations[0].payload.layer).toBe(20);
    }
  });

  it("preserves the final detached relationship in the compacted move", () => {
    const first = move("1", "mentions", 100, 0, 100);
    first.payload.detached = true;
    const checkpoint = projectCanonicalCheckpoint([first]);
    expect(checkpoint.ok).toBe(true);
    if (!checkpoint.ok || checkpoint.operations[0]?.type !== "move") return;
    expect(checkpoint.operations[0].payload.detached).toBe(true);
  });
});
