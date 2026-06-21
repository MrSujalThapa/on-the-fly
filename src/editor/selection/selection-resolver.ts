import type { EditorSelection } from "../editor-selection.js";
import { createEmptySelection } from "../editor-selection.js";
import type { VisualNodeId } from "../ids.js";
import type { MeasurementRect } from "../measurement/types.js";
import type { VisualNode } from "../visual-node.js";
import {
  promoteSelectionTarget,
} from "../visual-graph/container-detection.js";
import type { VisualLayoutGraph } from "../visual-graph/visual-layout-graph.js";
import {
  resolveClickTargetNode,
  shouldSkipContainerPromotion,
} from "./dom-target-matching.js";
import {
  buildDomSelectionTarget,
  resolveRectangleDomElements,
  type DomRectangleStats,
} from "./dom-rectangle-selection.js";
import { toggleNodeId } from "./point-queries.js";
import {
  isSelectableForInteraction,
  isWholePageLassoRect,
  isWholePageSelection,
} from "./selection-guards.js";

export interface SelectionResolveResult {
  selection: EditorSelection;
  resolvedNodes: VisualNode[];
  rejectedWholePage: boolean;
  rejectionReason?: string;
  rectangleStats?: DomRectangleStats;
}

export interface ClickResolveOptions {
  document?: Document;
}

export function resolveClickSelection(
  graph: VisualLayoutGraph,
  x: number,
  y: number,
  shiftKey: boolean,
  currentSelection: EditorSelection = createEmptySelection(),
  composedPath: EventTarget[] = [],
  options: ClickResolveOptions = {},
): SelectionResolveResult {
  const hit = resolveClickTargetNode(graph, x, y, composedPath, options.document);
  if (!hit || !isSelectableForInteraction(hit)) {
    return {
      selection: shiftKey ? currentSelection : createEmptySelection(),
      resolvedNodes: [],
      rejectedWholePage: false,
      rejectionReason: hit ? "blocked-node" : "empty",
    };
  }

  const promoted = shouldSkipContainerPromotion(hit, composedPath)
    ? hit
    : promoteSelectionTarget(
        hit,
        graph.toSnapshot().nodes,
        graph.getViewport(),
      );

  if (shiftKey) {
    const nextIds = toggleNodeId(currentSelection.selectedNodeIds, promoted.id);
    const resolvedNodes = nextIds
      .map((nodeId) => graph.getNodeById(nodeId))
      .filter((node): node is NonNullable<typeof node> => node !== undefined);

    if (isWholePageSelection(resolvedNodes, graph.getSelectableNodes(), null, graph.getViewport())) {
      return {
        selection: currentSelection,
        resolvedNodes: [],
        rejectedWholePage: true,
        rejectionReason: "whole-page",
      };
    }

    return {
      selection: {
        selectedNodeIds: nextIds,
        activeNodeId: promoted.id,
        source: "shift-click",
      },
      resolvedNodes,
      rejectedWholePage: false,
    };
  }

  return {
    selection: {
      selectedNodeIds: [promoted.id],
      activeNodeId: promoted.id,
      source: "click",
    },
    resolvedNodes: [promoted],
    rejectedWholePage: false,
  };
}

export interface LassoResolveOptions {
  document?: Document;
}

/**
 * Rectangle selection is DOM-first: the drawn rectangle is resolved entirely
 * from `document.elementsFromPoint` and DOM ancestry. The VisualGraph is only
 * consulted afterwards to enrich each DOM target with a stable node id when an
 * obvious match exists; resolution never depends on that mapping succeeding.
 */
export function resolveLassoSelection(
  graph: VisualLayoutGraph,
  lassoRect: MeasurementRect,
  currentSelection: EditorSelection = createEmptySelection(),
  appendWithShift = false,
  options: LassoResolveOptions = {},
): SelectionResolveResult {
  const viewport = graph.getViewport();
  if (isWholePageLassoRect(lassoRect, viewport)) {
    return {
      selection: appendWithShift ? currentSelection : createEmptySelection(),
      resolvedNodes: [],
      rejectedWholePage: true,
      rejectionReason: "whole-page",
    };
  }

  if (!options.document) {
    return {
      selection: appendWithShift ? currentSelection : createEmptySelection(),
      resolvedNodes: [],
      rejectedWholePage: false,
      rejectionReason: "missing-document",
    };
  }

  const domResult = resolveRectangleDomElements(options.document, lassoRect, viewport);

  if (domResult.elements.length === 0) {
    const rejectedWholePage = domResult.stats.rejectionReason === "whole-page";
    return {
      selection: appendWithShift ? currentSelection : createEmptySelection(),
      resolvedNodes: [],
      rejectedWholePage,
      rejectionReason: domResult.stats.rejectionReason ?? "empty",
      rectangleStats: domResult.stats,
    };
  }

  const resolvedNodes = domResult.elements.map((element, index) => {
    const node = buildDomSelectionTarget(element, `otf-rect-${String(index)}`, viewport);
    const graphId = findGraphNodeIdForElement(graph, node);
    if (graphId) {
      node.id = graphId;
    }
    return node;
  });

  const selectedIds = appendWithShift
    ? mergeNodeIds(
        currentSelection.selectedNodeIds,
        resolvedNodes.map((node) => node.id),
      )
    : resolvedNodes.map((node) => node.id);

  const selection: EditorSelection = {
    selectedNodeIds: selectedIds,
    source: "lasso",
  };

  const activeNode = resolvedNodes[0];
  if (activeNode) {
    selection.activeNodeId = activeNode.id;
  }

  return {
    selection,
    resolvedNodes,
    rejectedWholePage: false,
    rectangleStats: domResult.stats,
  };
}

function findGraphNodeIdForElement(
  graph: VisualLayoutGraph,
  node: VisualNode,
): VisualNodeId | undefined {
  for (const candidate of graph.getNodes()) {
    if (candidate.signature.cssPath === node.signature.cssPath) {
      return candidate.id;
    }
  }

  const idAttr = node.signature.idAttr;
  if (idAttr) {
    for (const candidate of graph.getNodes()) {
      if (
        candidate.signature.tagName === node.signature.tagName &&
        candidate.signature.idAttr === idAttr
      ) {
        return candidate.id;
      }
    }
  }

  return undefined;
}

function mergeNodeIds(existing: VisualNodeId[], next: VisualNodeId[]): VisualNodeId[] {
  const merged = new Set(existing);
  for (const nodeId of next) {
    merged.add(nodeId);
  }
  return Array.from(merged);
}

export {
  isLassoGesture,
  LASSO_DRAG_THRESHOLD_PX,
  normalizeLassoRect,
} from "./pointer-interaction.js";
