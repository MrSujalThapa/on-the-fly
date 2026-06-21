import { describe, expect, it, vi } from "vitest";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import { createSelectionController } from "../../../src/editor/selection/selection-controller.js";
import type { SelectionResolveResult } from "../../../src/editor/selection/selection-resolver.js";
import { VisualLayoutGraph } from "../../../src/editor/visual-graph/visual-layout-graph.js";
import type { VisualNode } from "../../../src/editor/visual-node.js";
import { createTestDocument } from "../dom/test-document.js";
import { layoutElement } from "../measurement/layout-helpers.js";

function createNode(overrides: Partial<VisualNode> & Pick<VisualNode, "id">): VisualNode {
  return {
    kind: "container",
    signature: {
      cssPath: "main section",
      tagName: "section",
      classList: [],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
    rect: { x: 0, y: 0, width: 200, height: 120 },
    computed: {},
    childIds: [],
    isLikelyContainer: true,
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

describe("selection controller grouping", () => {
  it("groups click-selected visual nodes into one virtual group", () => {
    const c1 = createNode({
      id: "c1",
      signature: {
        cssPath: "main section#c1",
        tagName: "section",
        idAttr: "c1",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
      rect: { x: 40, y: 40, width: 200, height: 120 },
    });
    const c2 = createNode({
      id: "c2",
      signature: {
        cssPath: "main section#c2",
        tagName: "section",
        idAttr: "c2",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
      rect: { x: 300, y: 40, width: 200, height: 120 },
    });
    // Extra selectable nodes keep the whole-page guard from tripping on a
    // 2-of-2 selection (real pages have many selectable nodes).
    const filler = [
      createNode({ id: "c3", rect: { x: 40, y: 300, width: 200, height: 120 } }),
      createNode({ id: "c4", rect: { x: 300, y: 300, width: 200, height: 120 } }),
    ];
    const graph = buildGraph([c1, c2, ...filler]);
    const { document, root } = createTestDocument(
      `<main><section id="c1">A</section><section id="c2">B</section></main>`,
    );
    const c1El = root.querySelector("#c1") as HTMLElement;
    const c2El = root.querySelector("#c2") as HTMLElement;
    layoutElement(c1El, c1.rect);
    layoutElement(c2El, c2.rect);

    document.elementsFromPoint = vi.fn((x: number) =>
      x < 260
        ? [c1El, root, document.body, document.documentElement]
        : [c2El, root, document.body, document.documentElement],
    );

    const results: SelectionResolveResult[] = [];
    const controller = createSelectionController({
      getGraph: () => graph,
      getDocument: () => document,
      onSelectionChange: (_selection, result) => {
        results.push(result);
      },
    });

    controller.handlePointerClick(120, 100, false);
    controller.handlePointerClick(380, 100, true);

    const groupResult = controller.groupSelection();

    expect(groupResult.group).toBeDefined();
    expect(groupResult.group?.memberIds.sort()).toEqual(["c1", "c2"]);
    expect(groupResult.group?.source).toBe("visual-node");
    expect(groupResult.group?.unionRect).toEqual({ x: 40, y: 40, width: 460, height: 120 });
    expect(groupResult.selection.source).toBe("group");
    expect(groupResult.selection.activeGroupId).toBe(groupResult.group?.id);
    expect(controller.getActiveGroup()?.id).toBe(groupResult.group?.id);
  });

  it("groups DOM-derived rectangle selection and ungroups back to members", () => {
    // Empty graph: rectangle selection must succeed purely from the DOM.
    const graph = buildGraph([]);
    const { document, root } = createTestDocument(`
      <ul id="feed">
        <li id="row-1" class="notification-item"><span id="t1">Alice</span></li>
        <li id="row-2" class="notification-item"><span id="t2">Bob</span></li>
      </ul>
    `);
    const row1 = root.querySelector("#row-1") as HTMLElement;
    const row2 = root.querySelector("#row-2") as HTMLElement;
    const t1 = root.querySelector("#t1") as HTMLElement;
    const t2 = root.querySelector("#t2") as HTMLElement;
    layoutElement(row1, { x: 20, y: 20, width: 360, height: 60 });
    layoutElement(row2, { x: 20, y: 90, width: 360, height: 60 });
    layoutElement(t1, { x: 40, y: 30, width: 200, height: 24 });
    layoutElement(t2, { x: 40, y: 100, width: 200, height: 24 });

    document.elementsFromPoint = vi.fn((_x: number, y: number) =>
      y < 85
        ? [t1, row1, root, document.body, document.documentElement]
        : [t2, row2, root, document.body, document.documentElement],
    );

    const results: SelectionResolveResult[] = [];
    const controller = createSelectionController({
      getGraph: () => graph,
      getDocument: () => document,
      onSelectionChange: (_selection, result) => {
        results.push(result);
      },
    });

    const lassoResult = controller.handleLassoRect({ x: 18, y: 18, width: 366, height: 136 }, false);
    expect(lassoResult.resolvedNodes).toHaveLength(2);

    const groupResult = controller.groupSelection();
    expect(groupResult.group).toBeDefined();
    expect(groupResult.group?.source).toBe("dom");
    expect(groupResult.group?.members).toHaveLength(2);
    expect(results.at(-1)?.group).toBeDefined();

    const memberIds = groupResult.group?.memberIds ?? [];

    const ungroupResult = controller.ungroupSelection();
    expect(ungroupResult.group).toBeUndefined();
    expect(ungroupResult.resolvedNodes).toHaveLength(2);
    expect(ungroupResult.selection.selectedNodeIds.sort()).toEqual([...memberIds].sort());
    expect(ungroupResult.selection.activeGroupId).toBeUndefined();
    expect(controller.getActiveGroup()).toBeNull();
  });

  it("recomputes the active group rect from current member rects", () => {
    const graph = buildGraph([]);
    const { document, root } = createTestDocument(`
      <ul id="feed">
        <li id="row-1" class="notification-item"><span id="t1">Alice</span></li>
        <li id="row-2" class="notification-item"><span id="t2">Bob</span></li>
      </ul>
    `);
    const row1 = root.querySelector("#row-1") as HTMLElement;
    const row2 = root.querySelector("#row-2") as HTMLElement;
    const t1 = root.querySelector("#t1") as HTMLElement;
    const t2 = root.querySelector("#t2") as HTMLElement;
    layoutElement(row1, { x: 20, y: 20, width: 360, height: 60 });
    layoutElement(row2, { x: 20, y: 90, width: 360, height: 60 });
    layoutElement(t1, { x: 40, y: 30, width: 200, height: 24 });
    layoutElement(t2, { x: 40, y: 100, width: 200, height: 24 });

    document.elementsFromPoint = vi.fn((_x: number, y: number) =>
      y < 85
        ? [t1, row1, root, document.body, document.documentElement]
        : [t2, row2, root, document.body, document.documentElement],
    );

    const controller = createSelectionController({
      getGraph: () => graph,
      getDocument: () => document,
    });

    controller.handleLassoRect({ x: 18, y: 18, width: 366, height: 136 }, false);
    const grouped = controller.groupSelection();
    const originalUnion = grouped.group?.unionRect;
    expect(originalUnion).toEqual({ x: 20, y: 20, width: 360, height: 130 });

    // Simulate row-2 moving to a new visual location after an edit.
    layoutElement(row2, { x: 20, y: 90, width: 520, height: 60 });

    const refreshed = controller.refreshActiveGroup();
    expect(refreshed?.unionRect).toEqual({ x: 20, y: 20, width: 520, height: 130 });
  });
});
