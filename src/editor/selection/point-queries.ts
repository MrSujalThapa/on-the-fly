import type { VisualNodeId } from "../ids.js";
import { rectArea } from "../measurement/geometry.js";
import type { VisualNode } from "../visual-node.js";
import { isSelectableNode } from "../visual-graph/graph-queries.js";
import type { GraphQueryOptions } from "../visual-graph/types.js";
import { isBlockedSelectionNode } from "./selection-guards.js";

export function findNodesAtPoint(
  nodes: Iterable<VisualNode>,
  x: number,
  y: number,
  options: GraphQueryOptions = {},
): VisualNode[] {
  const matches: VisualNode[] = [];

  for (const node of nodes) {
    if (!isSelectableNode(node, options) || isBlockedSelectionNode(node)) {
      continue;
    }

    if (pointInRect(x, y, node.rect)) {
      matches.push(node);
    }
  }

  return matches.sort(compareHitPriority);
}

function pointInRect(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

function compareHitPriority(left: VisualNode, right: VisualNode): number {
  const leftArea = rectArea(left.rect);
  const rightArea = rectArea(right.rect);
  if (leftArea !== rightArea) {
    return leftArea - rightArea;
  }

  const leftDepth = left.signature.cssPath.split(">").length;
  const rightDepth = right.signature.cssPath.split(">").length;
  return rightDepth - leftDepth;
}

export function pickDeepestNodeAtPoint(
  nodes: Iterable<VisualNode>,
  x: number,
  y: number,
  options: GraphQueryOptions = {},
): VisualNode | undefined {
  const hits = findNodesAtPoint(nodes, x, y, options);
  return hits[0];
}

export function toggleNodeId(
  selectedNodeIds: VisualNodeId[],
  nodeId: VisualNodeId,
): VisualNodeId[] {
  if (selectedNodeIds.includes(nodeId)) {
    return selectedNodeIds.filter((id) => id !== nodeId);
  }

  return [...selectedNodeIds, nodeId];
}
