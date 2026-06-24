import { describe, expect, it } from "vitest";
import { keepLatestZIndexOperationsByTarget } from "../../../src/editor/persistence/z-index-target-matching.js";
import { sortOperationsForReplay } from "../../../src/editor/persistence/replay-operation-order.js";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import type { EditorOperation, ZIndexOperation } from "../../../src/editor/operations.js";
import { FRONT_LAYER, BACK_LAYER } from "../../../src/editor/transform/layer-order.js";

const PAGE_KEY = "https://example.com/";

function zIndexForNode(
  id: string,
  nodeId: string,
  layer: number,
  cssPath: string,
): ZIndexOperation {
  return {
    id,
    type: "zIndex",
    pageKey: PAGE_KEY,
    target: {
      nodeId,
      signature: {
        cssPath,
        tagName: "div",
        classList: ["box"],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
    },
    payload: { layer },
    createdAt: 1,
    source: "manual",
    status: "approved",
  };
}

describe("z-index target matching regressions", () => {
  it("keeps latest zIndex for each sibling node id", () => {
    const operations = [
      zIndexForNode("z-a-back", "node-a", BACK_LAYER, "main div.box-a"),
      zIndexForNode("z-b-front", "node-b", FRONT_LAYER, "main div.box-b"),
      zIndexForNode("z-a-front", "node-a", FRONT_LAYER, "main div.box-a"),
    ];

    const compacted = keepLatestZIndexOperationsByTarget(operations);
    expect(compacted).toHaveLength(2);
    expect(compacted.map((operation) => operation.id)).toEqual(["z-b-front", "z-a-front"]);
  });

  it("replays move before zIndex even when saved in reverse order", () => {
    const move: EditorOperation = {
      id: "move-1",
      type: "move",
      pageKey: PAGE_KEY,
      target: {
        nodeId: "tab-1",
        signature: {
          cssPath: "main button.tab",
          tagName: "button",
          classList: ["tab"],
          boundingBoxHint: createEmptyBoundingBoxHint(),
        },
      },
      payload: { dx: 40, dy: 0, transformOnly: true },
      createdAt: 2,
      source: "manual",
      status: "approved",
    };
    const layer = zIndexForNode("z-tab", "tab-1", FRONT_LAYER, "main button.tab");
    layer.createdAt = 1;

    const sorted = sortOperationsForReplay([layer, move]);
    expect(sorted.map((operation) => operation.type)).toEqual(["move", "zIndex"]);
  });
});
