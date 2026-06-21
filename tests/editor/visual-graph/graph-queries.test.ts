import { describe, expect, it } from "vitest";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import {
  findNearestContainer,
  findNearestParent,
  findNodesInRect,
  isSelectableNode,
} from "../../../src/editor/visual-graph/graph-queries.js";
import type { VisualNode } from "../../../src/editor/visual-node.js";

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

describe("graph queries", () => {
  const nodes = new Map<string, VisualNode>([
    [
      "page",
      createNode({
        id: "page",
        kind: "container",
        isLikelyContainer: true,
        isPageLevel: true,
        rect: { x: 0, y: 0, width: 1000, height: 800 },
        childIds: ["card", "text"],
      }),
    ],
    [
      "card",
      createNode({
        id: "card",
        kind: "container",
        isLikelyContainer: true,
        parentId: "page",
        rect: { x: 20, y: 20, width: 300, height: 200 },
        childIds: ["text"],
      }),
    ],
    [
      "text",
      createNode({
        id: "text",
        kind: "text",
        parentId: "card",
        rect: { x: 40, y: 40, width: 120, height: 24 },
      }),
    ],
    [
      "outside",
      createNode({
        id: "outside",
        kind: "text",
        rect: { x: 500, y: 500, width: 80, height: 20 },
      }),
    ],
  ]);

  it("finds nodes overlapping a rect and excludes page-level nodes by default", () => {
    const matches = findNodesInRect(nodes.values(), { x: 0, y: 0, width: 400, height: 300 });

    expect(matches.map((node) => node.id)).toEqual(["card", "text"]);
    expect(matches.some((node) => node.id === "page")).toBe(false);
  });

  it("can include page-level nodes when requested", () => {
    const matches = findNodesInRect(
      nodes.values(),
      { x: 0, y: 0, width: 1000, height: 800 },
      { includePageLevel: true },
    );

    expect(matches.some((node) => node.id === "page")).toBe(true);
  });

  it("finds nearest parent and container ancestors", () => {
    expect(findNearestParent(nodes, "text")?.id).toBe("card");
    expect(findNearestContainer(nodes, "text")?.id).toBe("card");
    expect(findNearestContainer(nodes, "outside")).toBeUndefined();
  });

  it("filters selectable nodes and kinds", () => {
    expect(isSelectableNode(nodes.get("page") as VisualNode)).toBe(false);
    expect(
      isSelectableNode(nodes.get("text") as VisualNode, { kinds: ["text"] }),
    ).toBe(true);
    expect(
      isSelectableNode(nodes.get("text") as VisualNode, { kinds: ["button"] }),
    ).toBe(false);
  });
});
