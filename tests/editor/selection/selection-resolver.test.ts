import { describe, expect, it, vi } from "vitest";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import { promoteSelectionTarget } from "../../../src/editor/visual-graph/container-detection.js";
import { VisualLayoutGraph } from "../../../src/editor/visual-graph/visual-layout-graph.js";
import {
  resolveClickSelection,
  resolveLassoSelection,
} from "../../../src/editor/selection/selection-resolver.js";
import { isWholePageSelection } from "../../../src/editor/selection/selection-guards.js";
import type { VisualNode } from "../../../src/editor/visual-node.js";
import { createTestDocument } from "../dom/test-document.js";
import { layoutElement } from "../measurement/layout-helpers.js";

function createNode(overrides: Partial<VisualNode> & Pick<VisualNode, "id">): VisualNode {
  return {
    kind: "unknown",
    signature: {
      cssPath: "main div",
      tagName: "div",
      classList: [],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
    rect: { x: 0, y: 0, width: 100, height: 100 },
    computed: {},
    childIds: [],
    ...overrides,
  };
}

function buildGraph(nodes: VisualNode[]): VisualLayoutGraph {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return VisualLayoutGraph.fromScanResult(
    { nodes: nodeMap, rootNodeIds: nodes.filter((node) => !node.parentId).map((node) => node.id) },
    { width: 1000, height: 800 },
    1,
    1,
  );
}

describe("selection resolver", () => {
  const card = createNode({
    id: "card",
    kind: "container",
    isLikelyContainer: true,
    rect: { x: 40, y: 40, width: 320, height: 220 },
    computed: { backgroundColor: "rgb(255, 255, 255)", borderRadius: "12px" },
    childIds: ["title"],
  });
  const title = createNode({
    id: "title",
    kind: "text",
    parentId: "card",
    rect: { x: 64, y: 64, width: 180, height: 28 },
  });
  const button = createNode({
    id: "button",
    kind: "button",
    rect: { x: 500, y: 60, width: 120, height: 36 },
  });

  const graph = buildGraph([card, title, button]);

  it("selects the deepest node and promotes leaf hits to card containers", () => {
    const result = resolveClickSelection(graph, 100, 70, false);
    expect(result.resolvedNodes[0]?.id).toBe("card");
    expect(result.selection.source).toBe("click");
  });

  it("supports shift-click multi-select toggling", () => {
    const first = resolveClickSelection(graph, 520, 70, false);
    const second = resolveClickSelection(graph, 100, 70, true, first.selection);

    expect(second.selection.selectedNodeIds.sort()).toEqual(["button", "card"].sort());
    expect(second.selection.source).toBe("shift-click");
  });

  it("resolves lasso hits from elementsFromPoint sampling", () => {
    const cardNode = createNode({
      id: "card",
      kind: "container",
      isLikelyContainer: true,
      signature: {
        cssPath: "main section#card",
        tagName: "section",
        idAttr: "card",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
      rect: { x: 40, y: 40, width: 320, height: 220 },
      computed: { backgroundColor: "rgb(255, 255, 255)", borderRadius: "12px" },
      childIds: ["title"],
    });
    const titleNode = createNode({
      id: "title",
      kind: "text",
      parentId: "card",
      signature: {
        cssPath: "main h2#title",
        tagName: "h2",
        idAttr: "title",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
      rect: { x: 64, y: 64, width: 180, height: 28 },
    });
    const sampledGraph = buildGraph([cardNode, titleNode]);
    const { document, root } = createTestDocument(
      `<main><section id="card"><h2 id="title">Heading</h2></section></main>`,
    );
    const heading = root.querySelector("#title") as HTMLHeadingElement;
    const section = root.querySelector("#card") as HTMLElement;
    layoutElement(section, cardNode.rect);
    layoutElement(heading, titleNode.rect);

    document.elementsFromPoint = vi.fn(() => [
      heading,
      section,
      root,
      document.body,
      document.documentElement,
    ]);

    const result = resolveLassoSelection(
      sampledGraph,
      { x: 30, y: 30, width: 360, height: 250 },
      undefined,
      false,
      { document },
    );

    expect(result.resolvedNodes.length).toBeGreaterThan(0);
    expect(result.selection.source).toBe("lasso");
  });

  it("rejects whole-page lasso selections", () => {
    const manyNodes = Array.from({ length: 8 }, (_, index) =>
      createNode({
        id: `node-${String(index)}`,
        kind: "text",
        rect: { x: 20 + index * 20, y: 20, width: 80, height: 24 },
      }),
    );
    const crowdedGraph = buildGraph(manyNodes);
    const selectable = crowdedGraph.getSelectableNodes();
    const result = resolveLassoSelection(
      crowdedGraph,
      { x: 0, y: 0, width: 990, height: 790 },
    );

    expect(result.rejectedWholePage).toBe(true);
    expect(result.resolvedNodes).toHaveLength(0);
    expect(
      isWholePageSelection(
        selectable,
        selectable,
        { x: 0, y: 0, width: 990, height: 790 },
        crowdedGraph.getViewport(),
      ),
    ).toBe(true);
  });
});

describe("promotion guardrails", () => {
  it("does not promote buttons inside cards", () => {
    const card = createNode({
      id: "card",
      kind: "container",
      isLikelyContainer: true,
      rect: { x: 40, y: 40, width: 320, height: 220 },
      computed: { backgroundColor: "rgb(255, 255, 255)", borderRadius: "12px" },
      childIds: ["action"],
    });
    const action = createNode({
      id: "action",
      kind: "button",
      parentId: "card",
      rect: { x: 64, y: 180, width: 120, height: 36 },
    });
    const nodes = new Map([
      ["card", card],
      ["action", action],
    ]);

    expect(promoteSelectionTarget(action, nodes, { width: 1000, height: 800 }).id).toBe("action");
  });
});
