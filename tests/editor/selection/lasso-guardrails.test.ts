import { describe, expect, it, vi } from "vitest";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import { isWholePageSelection } from "../../../src/editor/selection/selection-guards.js";
import { resolveLassoSelection } from "../../../src/editor/selection/selection-resolver.js";
import { VisualLayoutGraph } from "../../../src/editor/visual-graph/visual-layout-graph.js";
import type { VisualNode } from "../../../src/editor/visual-node.js";
import { createTestDocument } from "../dom/test-document.js";
import { layoutElement } from "../measurement/layout-helpers.js";

function createNode(overrides: Partial<VisualNode> & Pick<VisualNode, "id">): VisualNode {
  return {
    kind: "text",
    signature: {
      cssPath: "main p",
      tagName: "p",
      classList: [],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
    rect: { x: 0, y: 0, width: 80, height: 24 },
    computed: {},
    childIds: [],
    ...overrides,
  };
}

describe("lasso guardrails", () => {
  it("allows a small lasso that selects every node on a sparse page", () => {
    const nodes = [
      createNode({
        id: "a",
        signature: {
          cssPath: "main p#a",
          tagName: "p",
          idAttr: "a",
          classList: [],
          boundingBoxHint: createEmptyBoundingBoxHint(),
        },
        rect: { x: 20, y: 20, width: 80, height: 24 },
      }),
      createNode({
        id: "b",
        signature: {
          cssPath: "main p#b",
          tagName: "p",
          idAttr: "b",
          classList: [],
          boundingBoxHint: createEmptyBoundingBoxHint(),
        },
        rect: { x: 20, y: 60, width: 80, height: 24 },
      }),
    ];
    const graph = VisualLayoutGraph.fromScanResult(
      {
        nodes: new Map(nodes.map((node) => [node.id, node])),
        rootNodeIds: nodes.map((node) => node.id),
      },
      { width: 1000, height: 800 },
      1,
      1,
    );
    const { document, root } = createTestDocument(`<main><p id="a">One</p><p id="b">Two</p></main>`);
    const first = root.querySelector("#a") as HTMLParagraphElement;
    const second = root.querySelector("#b") as HTMLParagraphElement;
    layoutElement(first, nodes[0]?.rect ?? { x: 20, y: 20, width: 80, height: 24 });
    layoutElement(second, nodes[1]?.rect ?? { x: 20, y: 60, width: 80, height: 24 });

    document.elementsFromPoint = vi.fn((x: number, y: number) => {
      if (y < 45) {
        return [first, root, document.body, document.documentElement];
      }
      return [second, root, document.body, document.documentElement];
    });

    const lassoRect = { x: 10, y: 10, width: 120, height: 90 };
    const result = resolveLassoSelection(graph, lassoRect, undefined, false, { document });

    expect(result.rejectedWholePage).toBe(false);
    expect(result.selection.selectedNodeIds.sort()).toEqual(["a", "b"]);
    expect(
      isWholePageSelection(
        result.resolvedNodes,
        graph.getSelectableNodes(),
        lassoRect,
        graph.getViewport(),
      ),
    ).toBe(false);
  });
});
