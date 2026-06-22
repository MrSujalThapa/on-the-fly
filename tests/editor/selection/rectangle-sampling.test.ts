import { describe, expect, it, vi } from "vitest";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import {
  buildRectangleSampleGrid,
  getFilteredElementsFromPoint,
  isSelectableLassoSampleElement,
  mapSampledElementToVisualNode,
  MAX_RECT_SAMPLE_COUNT,
  MIN_RECT_SAMPLE_COUNT,
} from "../../../src/editor/selection/rectangle-sampling.js";
import {
  resolveClickSelection,
  resolveLassoSelection,
} from "../../../src/editor/selection/selection-resolver.js";
import { resolveClickTargetFromElementsFromPoint } from "../../../src/editor/selection/dom-target-matching.js";
import { isWholePageSelection } from "../../../src/editor/selection/selection-guards.js";
import { promoteSelectionTarget } from "../../../src/editor/visual-graph/container-detection.js";
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

function buildGraph(nodes: VisualNode[]): VisualLayoutGraph {
  return VisualLayoutGraph.fromScanResult(
    {
      nodes: new Map(nodes.map((node) => [node.id, node])),
      rootNodeIds: nodes.filter((node) => !node.parentId).map((node) => node.id),
    },
    { width: 1000, height: 800 },
    1,
    1,
  );
}

describe("rectangle sampling grid", () => {
  it("generates inset sample points across the rectangle", () => {
    const points = buildRectangleSampleGrid({ x: 10, y: 20, width: 80, height: 40 });

    expect(points.length).toBeGreaterThanOrEqual(MIN_RECT_SAMPLE_COUNT);
    expect(points.length).toBeLessThanOrEqual(MAX_RECT_SAMPLE_COUNT);
    expect(points.every((point) => point.x >= 11 && point.x <= 89)).toBe(true);
    expect(points.every((point) => point.y >= 21 && point.y <= 59)).toBe(true);
  });

  it("samples the center for tiny rectangles", () => {
    const points = buildRectangleSampleGrid({ x: 50, y: 60, width: 0, height: 0 });

    expect(points).toEqual([{ x: 50, y: 60 }]);
  });
});

describe("elementsFromPoint filtering", () => {
  it("filters html/body/script/meta/svg internals and extension root", () => {
    const { document, root } = createTestDocument(`
      <main><p id="copy">Visible</p></main>
    `);
    const paragraph = root.querySelector("#copy") as HTMLParagraphElement;
    layoutElement(paragraph, { x: 40, y: 40, width: 120, height: 24 });

    const script = document.createElement("script");
    const meta = document.createElement("meta");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path);
    const extensionHost = document.createElement("div");
    extensionHost.id = "on-the-fly-root-host";
    extensionHost.setAttribute("data-on-the-fly", "root-host");

    const viewport = { width: 1024, height: 768 };

    expect(isSelectableLassoSampleElement(document.documentElement, viewport)).toBe(false);
    expect(isSelectableLassoSampleElement(document.body, viewport)).toBe(false);
    expect(isSelectableLassoSampleElement(script, viewport)).toBe(false);
    expect(isSelectableLassoSampleElement(meta, viewport)).toBe(false);
    expect(isSelectableLassoSampleElement(path, viewport)).toBe(false);
    expect(isSelectableLassoSampleElement(extensionHost, viewport)).toBe(false);
    expect(isSelectableLassoSampleElement(paragraph, viewport)).toBe(true);

    document.elementsFromPoint = vi.fn(() => [
      extensionHost,
      path,
      meta,
      script,
      document.body,
      paragraph,
    ]);

    const filtered = getFilteredElementsFromPoint(document, 80, 52, viewport);
    expect(filtered).toEqual([paragraph]);
  });
});

describe("sampled element to visual node mapping", () => {
  it("maps DOM elements to visual nodes and promotes text into card containers", () => {
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
      signature: {
        cssPath: "main h2#title",
        tagName: "h2",
        idAttr: "title",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
      rect: { x: 64, y: 64, width: 180, height: 28 },
    });
    const graph = buildGraph([card, title]);

    const { root } = createTestDocument(
      `<main><section id="card"><h2 id="title">Heading</h2></section></main>`,
    );
    const heading = root.querySelector("#title") as HTMLHeadingElement;
    layoutElement(heading, title.rect);

    const mapped = mapSampledElementToVisualNode(graph, heading, 100, 70);
    expect(mapped?.id).toBe("card");
    expect(promoteSelectionTarget(title, graph.toSnapshot().nodes, graph.getViewport()).id).toBe("card");
  });

  it("keeps buttons as direct lasso targets", () => {
    const buttonNode = createNode({
      id: "action",
      kind: "button",
      signature: {
        cssPath: "main button#action",
        tagName: "button",
        idAttr: "action",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
      rect: { x: 100, y: 50, width: 120, height: 36 },
    });
    const graph = buildGraph([buttonNode]);
    const { root } = createTestDocument(`<main><button id="action">Save</button></main>`);
    const button = root.querySelector("#action") as HTMLButtonElement;
    layoutElement(button, buttonNode.rect);

    expect(mapSampledElementToVisualNode(graph, button, 120, 70)?.id).toBe("action");
  });
});

describe("click link and button stack selection", () => {
  it("selects anchors and buttons from elementsFromPoint stacks", () => {
    const link = createNode({
      id: "link",
      kind: "text",
      signature: {
        cssPath: "main a#nav-link",
        tagName: "a",
        idAttr: "nav-link",
        classList: ["nav-link"],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
      rect: { x: 40, y: 40, width: 160, height: 28 },
    });
    const button = createNode({
      id: "action",
      kind: "button",
      signature: {
        cssPath: "main button#action",
        tagName: "button",
        idAttr: "action",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
      rect: { x: 40, y: 100, width: 120, height: 36 },
    });
    const graph = buildGraph([link, button]);
    const { document, root } = createTestDocument(`
      <main>
        <a id="nav-link" class="nav-link" href="#"><span>Go</span></a>
        <button id="action">Save</button>
      </main>
    `);
    const anchor = root.querySelector("#nav-link") as HTMLAnchorElement;
    const span = anchor.querySelector("span") as HTMLSpanElement;
    const buttonElement = root.querySelector("#action") as HTMLButtonElement;
    layoutElement(anchor, link.rect);
    layoutElement(buttonElement, button.rect);

    document.elementsFromPoint = vi.fn((x: number) => {
      if (x < 80) {
        return [span, anchor, root, document.body, document.documentElement];
      }
      return [buttonElement, root, document.body, document.documentElement];
    });

    expect(resolveClickTargetFromElementsFromPoint(document, graph, 50, 50)?.id).toBe("link");

    const linkSelection = resolveClickSelection(graph, 50, 50, false, undefined, [], { document });
    expect(linkSelection.resolvedNodes[0]?.id).toBe("link");

    expect(resolveClickTargetFromElementsFromPoint(document, graph, 90, 110)?.id).toBe("action");

    const buttonSelection = resolveClickSelection(graph, 90, 110, false, undefined, [], { document });
    expect(buttonSelection.resolvedNodes[0]?.id).toBe("action");
  });
});

describe("rectangle selection resolution", () => {
  it("selects sparse-page elements from sampled DOM hits", () => {
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
    const graph = buildGraph(nodes);
    const { document, root } = createTestDocument(`<main><p id="a">One</p><p id="b">Two</p></main>`);
    const first = root.querySelector("#a") as HTMLParagraphElement;
    const second = root.querySelector("#b") as HTMLParagraphElement;
    layoutElement(first, { x: 20, y: 20, width: 80, height: 24 });
    layoutElement(second, { x: 20, y: 60, width: 80, height: 24 });

    document.elementsFromPoint = vi.fn((x: number, y: number) => {
      if (y < 45) {
        return [first, root, document.body, document.documentElement];
      }
      return [second, root, document.body, document.documentElement];
    });

    const lassoRect = { x: 10, y: 10, width: 120, height: 90 };

    const withoutDocument = resolveLassoSelection(graph, lassoRect);
    expect(withoutDocument.resolvedNodes).toHaveLength(0);
    expect(withoutDocument.rejectionReason).toBe("missing-document");

    const withDocument = resolveLassoSelection(graph, lassoRect, undefined, false, { document });
    expect(withDocument.rejectedWholePage).toBe(false);
    expect(withDocument.resolvedNodes).toHaveLength(2);
    expect(withDocument.selection.selectedNodeIds.sort()).toEqual(["a", "b"]);
    expect(withDocument.rectangleStats?.samplePointCount).toBeGreaterThan(0);
    expect(withDocument.rectangleStats?.selected).toHaveLength(2);
  });

  it("rejects huge rectangles that cover most of the page", () => {
    const manyNodes = Array.from({ length: 8 }, (_, index) =>
      createNode({
        id: `node-${String(index)}`,
        kind: "text",
        rect: { x: 20 + index * 20, y: 20, width: 80, height: 24 },
      }),
    );
    const graph = buildGraph(manyNodes);
    const { document } = createTestDocument(
      `<main>${manyNodes.map((_, index) => `<p id="node-${String(index)}">Item</p>`).join("")}</main>`,
    );

    document.elementsFromPoint = vi.fn(() =>
      manyNodes.map((node) => {
        const element = document.createElement("p");
        element.id = node.id;
        return element;
      }),
    );

    const lassoRect = { x: 0, y: 0, width: 990, height: 790 };
    const result = resolveLassoSelection(graph, lassoRect, undefined, false, { document });

    expect(result.rejectedWholePage).toBe(true);
    expect(result.rejectionReason).toBe("whole-page");
    expect(result.resolvedNodes).toHaveLength(0);
    expect(
      isWholePageSelection(
        graph.getSelectableNodes(),
        graph.getSelectableNodes(),
        lassoRect,
        graph.getViewport(),
      ),
    ).toBe(true);
  });

  it("reports sample stats for rectangle resolution", () => {
    const node = createNode({
      id: "copy",
      signature: {
        cssPath: "main p#copy",
        tagName: "p",
        idAttr: "copy",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
      rect: { x: 40, y: 40, width: 120, height: 24 },
    });
    const graph = buildGraph([node]);
    const { document, root } = createTestDocument(`<main><p id="copy">Visible</p></main>`);
    const paragraph = root.querySelector("#copy") as HTMLParagraphElement;
    layoutElement(paragraph, node.rect);

    document.elementsFromPoint = vi.fn(() => [
      paragraph,
      root,
      document.body,
      document.documentElement,
    ]);

    const result = resolveLassoSelection(
      graph,
      { x: 30, y: 30, width: 140, height: 50 },
      undefined,
      false,
      { document },
    );

    expect(result.rectangleStats?.samplePointCount).toBeGreaterThan(0);
    expect(result.rectangleStats?.collectedElementCount).toBeGreaterThan(0);
    expect(result.rectangleStats?.selected).toHaveLength(1);
    expect(result.resolvedNodes).toHaveLength(1);
  });
});
