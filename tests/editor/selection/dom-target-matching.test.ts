import { describe, expect, it } from "vitest";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import {
  findAnchorInComposedPath,
  resolveClickTargetNode,
  shouldSkipContainerPromotion,
} from "../../../src/editor/selection/dom-target-matching.js";
import { resolveClickSelection } from "../../../src/editor/selection/selection-resolver.js";
import { VisualLayoutGraph } from "../../../src/editor/visual-graph/visual-layout-graph.js";
import type { VisualNode } from "../../../src/editor/visual-node.js";
import { Window } from "happy-dom";

function createNode(overrides: Partial<VisualNode> & Pick<VisualNode, "id">): VisualNode {
  return {
    kind: "unknown",
    signature: {
      cssPath: "main a",
      tagName: "a",
      classList: [],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
    rect: { x: 0, y: 0, width: 100, height: 24 },
    computed: {},
    childIds: [],
    ...overrides,
  };
}

describe("dom target matching", () => {
  it("finds anchors in composed paths with nested spans", () => {
    const window = new Window({ innerWidth: 1024, innerHeight: 768 });
    const document = window.document as unknown as Document;
    document.body.innerHTML = `<main><a id="nav-link" class="nav-link" href="#"><span>Go</span></a></main>`;
    const anchor = document.querySelector("#nav-link") as HTMLAnchorElement;
    const span = anchor.querySelector("span") as HTMLSpanElement;

    expect(findAnchorInComposedPath([span, anchor, document.body])).toBe(anchor);
  });

  it("selects the anchor visual node when clicking nested link text", () => {
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
    const nestedText = createNode({
      id: "label",
      kind: "text",
      parentId: "link",
      signature: {
        cssPath: "main a#nav-link span",
        tagName: "span",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
      rect: { x: 48, y: 44, width: 80, height: 20 },
    });
    const graph = VisualLayoutGraph.fromScanResult(
      {
        nodes: new Map([
          ["link", link],
          ["label", nestedText],
        ]),
        rootNodeIds: ["link"],
      },
      { width: 1000, height: 800 },
      1,
      1,
    );

    const window = new Window({ innerWidth: 1024, innerHeight: 768 });
    const document = window.document as unknown as Document;
    document.body.innerHTML = `<main><a id="nav-link" class="nav-link" href="#"><span>Go</span></a></main>`;
    const anchor = document.querySelector("#nav-link") as HTMLAnchorElement;
    const span = anchor.querySelector("span") as HTMLSpanElement;
    const path = [span, anchor, document.body];

    const target = resolveClickTargetNode(graph, 50, 50, path);
    expect(target?.id).toBe("link");
    expect(target?.signature.tagName).toBe("a");
    expect(shouldSkipContainerPromotion(target as VisualNode, path)).toBe(true);

    const selection = resolveClickSelection(graph, 50, 50, false, undefined, path);
    expect(selection.resolvedNodes[0]?.id).toBe("link");
    expect(selection.selection.source).toBe("click");
  });
});
