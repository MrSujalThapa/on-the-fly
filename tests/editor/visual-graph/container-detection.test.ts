import { describe, expect, it } from "vitest";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import {
  enrichNodeContainerMetadata,
  isLikelyCardContainer,
  isPageWrapperNode,
  promoteSelectionTarget,
  scoreContainerLikelihood,
} from "../../../src/editor/visual-graph/container-detection.js";
import type { VisualNode } from "../../../src/editor/visual-node.js";

function createNode(overrides: Partial<VisualNode> & Pick<VisualNode, "id">): VisualNode {
  return {
    kind: "container",
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

describe("container detection", () => {
  const viewport = { width: 1000, height: 800 };

  it("detects profile-card-like containers and promotes leaf children", () => {
    const nodes = new Map<string, VisualNode>([
      [
        "card",
        createNode({
          id: "card",
          rect: { x: 40, y: 40, width: 320, height: 220 },
          computed: {
            backgroundColor: "rgb(255, 255, 255)",
            borderRadius: "12px",
          },
          childIds: ["title", "bio"],
        }),
      ],
      [
        "title",
        createNode({
          id: "title",
          kind: "text",
          parentId: "card",
          rect: { x: 64, y: 64, width: 180, height: 28 },
        }),
      ],
      [
        "bio",
        createNode({
          id: "bio",
          kind: "text",
          parentId: "card",
          rect: { x: 64, y: 104, width: 260, height: 80 },
        }),
      ],
    ]);

    enrichNodeContainerMetadata(nodes, viewport);
    const card = nodes.get("card") as VisualNode;
    const title = nodes.get("title") as VisualNode;

    expect(isLikelyCardContainer(card, nodes, viewport)).toBe(true);
    expect(scoreContainerLikelihood(card, nodes, viewport).total).toBeGreaterThanOrEqual(55);
    expect(promoteSelectionTarget(title, nodes, viewport).id).toBe("card");
  });

  it("keeps split sections selectable without promoting to a page wrapper", () => {
    const nodes = new Map<string, VisualNode>([
      [
        "split",
        createNode({
          id: "split",
          rect: { x: 20, y: 20, width: 760, height: 320 },
          computed: { backgroundColor: "rgb(245, 245, 245)" },
          childIds: ["left", "right"],
        }),
      ],
      [
        "left",
        createNode({
          id: "left",
          rect: { x: 36, y: 36, width: 350, height: 280 },
          computed: { backgroundColor: "rgb(255, 255, 255)", borderRadius: "8px" },
          childIds: ["left-title"],
        }),
      ],
      [
        "right",
        createNode({
          id: "right",
          rect: { x: 414, y: 36, width: 350, height: 280 },
          computed: { backgroundColor: "rgb(255, 255, 255)", borderRadius: "8px" },
          childIds: ["right-title"],
        }),
      ],
      [
        "left-title",
        createNode({
          id: "left-title",
          kind: "text",
          parentId: "left",
          rect: { x: 52, y: 52, width: 120, height: 24 },
        }),
      ],
      [
        "right-title",
        createNode({
          id: "right-title",
          kind: "text",
          parentId: "right",
          rect: { x: 430, y: 52, width: 120, height: 24 },
        }),
      ],
    ]);

    enrichNodeContainerMetadata(nodes, viewport);

    expect(isLikelyCardContainer(nodes.get("left") as VisualNode, nodes, viewport)).toBe(true);
    expect(isLikelyCardContainer(nodes.get("right") as VisualNode, nodes, viewport)).toBe(true);
    expect(isPageWrapperNode(nodes.get("split") as VisualNode, nodes, viewport)).toBe(false);
    expect(promoteSelectionTarget(nodes.get("left-title") as VisualNode, nodes, viewport).id).toBe(
      "left",
    );
  });

  it("rejects giant page wrappers", () => {
    const nodes = new Map<string, VisualNode>([
      [
        "wrapper",
        createNode({
          id: "wrapper",
          rect: { x: 0, y: 0, width: 980, height: 780 },
          childIds: ["content"],
        }),
      ],
      [
        "content",
        createNode({
          id: "content",
          kind: "text",
          parentId: "wrapper",
          rect: { x: 40, y: 40, width: 200, height: 24 },
        }),
      ],
    ]);

    enrichNodeContainerMetadata(nodes, viewport);
    const wrapper = nodes.get("wrapper") as VisualNode;

    expect(isPageWrapperNode(wrapper, nodes, viewport)).toBe(true);
    expect(wrapper.isPageLevel).toBe(true);
    expect(isLikelyCardContainer(wrapper, nodes, viewport)).toBe(false);
  });
});
