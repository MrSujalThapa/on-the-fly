import { describe, expect, it } from "vitest";
import type { MoveOperation } from "../../src/editor/operations.js";
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
});
