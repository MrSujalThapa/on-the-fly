import type { VisualNodeId } from "../ids.js";
import { containsRect, rectCenter, rectsOverlap } from "../measurement/geometry.js";
import type { MeasurementRect } from "../measurement/types.js";
import type { VisualNode } from "../visual-node.js";
import type { GraphQueryOptions, RectQueryOptions } from "./types.js";

export function isSelectableNode(
  node: VisualNode,
  options: GraphQueryOptions = {},
): boolean {
  if (node.isPageLevel && !options.includePageLevel) {
    return false;
  }

  if (options.kinds && !options.kinds.includes(node.kind)) {
    return false;
  }

  return true;
}

export function getNodeById(
  nodes: ReadonlyMap<VisualNodeId, VisualNode>,
  nodeId: VisualNodeId,
): VisualNode | undefined {
  return nodes.get(nodeId);
}

export function findNodesInRect(
  nodes: Iterable<VisualNode>,
  rect: MeasurementRect,
  options: RectQueryOptions = {},
): VisualNode[] {
  const mode = options.mode ?? "overlap";
  const matches: VisualNode[] = [];

  for (const node of nodes) {
    if (!isSelectableNode(node, options)) {
      continue;
    }

    if (matchesRectQuery(node.rect, rect, mode)) {
      matches.push(node);
    }
  }

  return matches.sort((left, right) => compareNodeSpecificity(left, right, rect));
}

function matchesRectQuery(
  nodeRect: MeasurementRect,
  queryRect: MeasurementRect,
  mode: NonNullable<RectQueryOptions["mode"]>,
): boolean {
  switch (mode) {
    case "center": {
      const center = rectCenter(nodeRect);
      return (
        center.x >= queryRect.x &&
        center.x <= queryRect.x + queryRect.width &&
        center.y >= queryRect.y &&
        center.y <= queryRect.y + queryRect.height
      );
    }
    case "contain":
      return containsRect(queryRect, nodeRect);
    case "overlap":
    default:
      return rectsOverlap(nodeRect, queryRect);
  }
}

function compareNodeSpecificity(
  left: VisualNode,
  right: VisualNode,
  queryRect: MeasurementRect,
): number {
  const leftArea = left.rect.width * left.rect.height;
  const rightArea = right.rect.width * right.rect.height;
  const queryArea = queryRect.width * queryRect.height;

  const leftDelta = Math.abs(leftArea - queryArea);
  const rightDelta = Math.abs(rightArea - queryArea);
  if (leftDelta !== rightDelta) {
    return leftDelta - rightDelta;
  }

  return leftArea - rightArea;
}

export function findNearestParent(
  nodes: ReadonlyMap<VisualNodeId, VisualNode>,
  nodeId: VisualNodeId,
  options: GraphQueryOptions = {},
): VisualNode | undefined {
  const node = nodes.get(nodeId);
  if (!node?.parentId) {
    return undefined;
  }

  let currentId: VisualNodeId | undefined = node.parentId;

  while (currentId) {
    const parent = nodes.get(currentId);
    if (!parent) {
      return undefined;
    }

    if (isSelectableNode(parent, options)) {
      return parent;
    }

    currentId = parent.parentId;
  }

  return undefined;
}

export function findNearestContainer(
  nodes: ReadonlyMap<VisualNodeId, VisualNode>,
  nodeId: VisualNodeId,
  options: GraphQueryOptions = {},
): VisualNode | undefined {
  const node = nodes.get(nodeId);
  if (!node?.parentId) {
    return undefined;
  }

  let currentId: VisualNodeId | undefined = node.parentId;

  while (currentId) {
    const candidate = nodes.get(currentId);
    if (!candidate) {
      return undefined;
    }

    const isContainer =
      candidate.kind === "container" || candidate.isLikelyContainer === true;

    if (isContainer && isSelectableNode(candidate, options)) {
      return candidate;
    }

    currentId = candidate.parentId;
  }

  return undefined;
}

export function filterSelectableNodes(
  nodes: Iterable<VisualNode>,
  options: GraphQueryOptions = {},
): VisualNode[] {
  return Array.from(nodes).filter((node) => isSelectableNode(node, options));
}
