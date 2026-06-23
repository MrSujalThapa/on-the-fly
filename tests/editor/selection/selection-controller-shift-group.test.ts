import { describe, expect, it, vi } from "vitest";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import { createSelectionController } from "../../../src/editor/selection/selection-controller.js";
import type { VisualNode } from "../../../src/editor/visual-node.js";
import { VisualLayoutGraph } from "../../../src/editor/visual-graph/visual-layout-graph.js";
import { createTestDocument } from "../../editor/dom/test-document.js";
import { layoutElement } from "../../editor/measurement/layout-helpers.js";

function createNode(overrides: Partial<VisualNode> & Pick<VisualNode, "id">): VisualNode {
  return {
    kind: "container",
    signature: {
      cssPath: `main section#${overrides.id}`,
      tagName: "section",
      idAttr: overrides.id,
      classList: [],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
    rect: { x: 40, y: 40, width: 200, height: 120 },
    computed: {},
    childIds: [],
    isLikelyContainer: true,
    ...overrides,
  };
}

describe("selection controller shift-add group behavior", () => {
  it("shift-adds a node to an active group without dropping the group", () => {
    const c1 = createNode({ id: "c1", rect: { x: 40, y: 40, width: 200, height: 120 } });
    const c2 = createNode({ id: "c2", rect: { x: 300, y: 40, width: 200, height: 120 } });
    const c3 = createNode({ id: "c3", rect: { x: 560, y: 40, width: 200, height: 120 } });
    const filler = [
      createNode({ id: "c4", rect: { x: 40, y: 300, width: 200, height: 120 } }),
      createNode({ id: "c5", rect: { x: 300, y: 300, width: 200, height: 120 } }),
    ];
    const graph = VisualLayoutGraph.fromScanResult(
      {
        nodes: new Map([c1, c2, c3, ...filler].map((node) => [node.id, node])),
        rootNodeIds: ["c1", "c2", "c3", "c4", "c5"],
      },
      { width: 1000, height: 800 },
      1,
      1,
    );

    const { document, root } = createTestDocument(
      `<main><section id="c1">A</section><section id="c2">B</section><section id="c3">C</section></main>`,
    );
    const c1El = root.querySelector("#c1") as HTMLElement;
    const c2El = root.querySelector("#c2") as HTMLElement;
    const c3El = root.querySelector("#c3") as HTMLElement;
    layoutElement(c1El, c1.rect);
    layoutElement(c2El, c2.rect);
    layoutElement(c3El, c3.rect);

    document.elementsFromPoint = vi.fn((x: number) => {
      if (x < 260) {
        return [c1El, root, document.body, document.documentElement];
      }
      if (x < 520) {
        return [c2El, root, document.body, document.documentElement];
      }
      return [c3El, root, document.body, document.documentElement];
    });

    const controller = createSelectionController({
      getGraph: () => graph,
      getDocument: () => document,
    });

    controller.handlePointerClick(120, 100, false);
    controller.handlePointerClick(380, 100, true);
    controller.groupSelection();
    controller.handlePointerClick(640, 100, true);

    const selection = controller.getSelection();
    expect(selection.activeGroupId).toBeDefined();
    expect(selection.selectedNodeIds.sort()).toEqual(["c1", "c2", "c3"]);
    expect(controller.getActiveGroup()?.memberIds.sort()).toEqual(["c1", "c2", "c3"]);
  });
});
