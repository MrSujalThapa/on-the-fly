import type { MatchViewport } from "../dom/types.js";
import { containsRect, rectArea } from "../measurement/geometry.js";
import type { MeasurementRect } from "../measurement/types.js";
import { GIANT_NODE_AREA_RATIO } from "../measurement/constants.js";
import type { VisualNodeId } from "../ids.js";
import type { VisualNode } from "../visual-node.js";

export const CARD_CONTAINER_SCORE_THRESHOLD = 55;
export const PROMOTION_CHILD_AREA_RATIO = 0.45;

const PROMOTABLE_LEAF_KINDS = new Set<VisualNode["kind"]>(["text", "image"]);

export interface ContainerScoreBreakdown {
  total: number;
  structure: number;
  surface: number;
  containment: number;
  alignment: number;
  penalties: number;
}

export function getNodeChildren(
  node: VisualNode,
  nodes: ReadonlyMap<VisualNodeId, VisualNode>,
): VisualNode[] {
  return node.childIds
    .map((childId) => nodes.get(childId))
    .filter((child): child is VisualNode => child !== undefined);
}

export function scoreContainerLikelihood(
  node: VisualNode,
  nodes: ReadonlyMap<VisualNodeId, VisualNode>,
  viewport: MatchViewport,
): ContainerScoreBreakdown {
  if (node.isPageLevel) {
    return { total: 0, structure: 0, surface: 0, containment: 0, alignment: 0, penalties: 100 };
  }

  const children = getNodeChildren(node, nodes).filter((child) => !child.isPageLevel);
  let structure = 0;
  let surface = 0;
  let containment = 0;
  let alignment = 0;
  let penalties = 0;

  if (node.kind === "container" || node.childIds.length >= 2) {
    structure += 20;
  }

  if (children.length >= 2) {
    structure += 15;
  }

  if (hasMixedChildStructure(children)) {
    structure += 10;
  }

  if (hasVisibleSurface(node)) {
    surface += 25;
  }

  if (hasRoundedSurface(node)) {
    surface += 10;
  }

  if (children.length > 0 && childrenFitInsideWithPadding(node.rect, children)) {
    containment += 20;
  }

  if (children.length >= 2 && areChildrenAligned(children)) {
    alignment += 15;
  }

  const viewportArea = Math.max(1, viewport.width * viewport.height);
  const areaRatio = rectArea(node.rect) / viewportArea;

  if (areaRatio >= GIANT_NODE_AREA_RATIO) {
    penalties += 100;
  } else if (areaRatio >= 0.75) {
    penalties += 40;
  } else if (areaRatio >= 0.08 && areaRatio <= 0.65) {
    structure += 10;
  }

  const total = Math.max(0, structure + surface + containment + alignment - penalties);
  return { total, structure, surface, containment, alignment, penalties };
}

export function isLikelyCardContainer(
  node: VisualNode,
  nodes: ReadonlyMap<VisualNodeId, VisualNode>,
  viewport: MatchViewport,
): boolean {
  return scoreContainerLikelihood(node, nodes, viewport).total >= CARD_CONTAINER_SCORE_THRESHOLD;
}

export function enrichNodeContainerMetadata(
  nodes: Map<VisualNodeId, VisualNode>,
  viewport: MatchViewport,
): void {
  for (const node of nodes.values()) {
    const score = scoreContainerLikelihood(node, nodes, viewport);
    node.isLikelyContainer = score.total >= CARD_CONTAINER_SCORE_THRESHOLD || node.kind === "container";
    node.isPageLevel =
      node.isPageLevel === true ||
      score.penalties >= 100 ||
      isPageWrapperNode(node, nodes, viewport);
  }
}

export function isPageWrapperNode(
  node: VisualNode,
  nodes: ReadonlyMap<VisualNodeId, VisualNode>,
  viewport: MatchViewport,
): boolean {
  if (node.isPageLevel) {
    return true;
  }

  const viewportArea = Math.max(1, viewport.width * viewport.height);
  const areaRatio = rectArea(node.rect) / viewportArea;
  if (areaRatio < GIANT_NODE_AREA_RATIO) {
    return false;
  }

  const children = getNodeChildren(node, nodes);
  return children.length <= 1;
}

export function shouldPromoteChildToContainer(
  child: VisualNode,
  container: VisualNode,
  nodes: ReadonlyMap<VisualNodeId, VisualNode>,
  viewport: MatchViewport,
): boolean {
  if (!isPromotableLeafNode(child)) {
    return false;
  }

  if (!isLikelyCardContainer(container, nodes, viewport)) {
    return false;
  }

  const childArea = rectArea(child.rect);
  const containerArea = Math.max(1, rectArea(container.rect));
  if (childArea / containerArea > PROMOTION_CHILD_AREA_RATIO) {
    return false;
  }

  return containsRect(container.rect, child.rect);
}

export function promoteSelectionTarget(
  node: VisualNode,
  nodes: ReadonlyMap<VisualNodeId, VisualNode>,
  viewport: MatchViewport,
): VisualNode {
  if (!isPromotableLeafNode(node)) {
    return node;
  }

  let current: VisualNode = node;

  while (current.parentId) {
    const parent = nodes.get(current.parentId);
    if (!parent || parent.isPageLevel) {
      break;
    }

    if (shouldPromoteChildToContainer(current, parent, nodes, viewport)) {
      return parent;
    }

    current = parent;
  }

  return node;
}

export function findBestCardContainerAncestor(
  nodeId: VisualNodeId,
  nodes: ReadonlyMap<VisualNodeId, VisualNode>,
  viewport: MatchViewport,
): VisualNode | undefined {
  const node = nodes.get(nodeId);
  if (!node?.parentId) {
    return undefined;
  }

  let best: VisualNode | undefined;
  let bestScore = CARD_CONTAINER_SCORE_THRESHOLD - 1;
  let currentId: VisualNodeId | undefined = node.parentId;

  while (currentId) {
    const candidate = nodes.get(currentId);
    if (!candidate || candidate.isPageLevel) {
      break;
    }

    const score = scoreContainerLikelihood(candidate, nodes, viewport).total;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }

    currentId = candidate.parentId;
  }

  return best;
}

function isPromotableLeafNode(node: VisualNode): boolean {
  return PROMOTABLE_LEAF_KINDS.has(node.kind);
}

function hasMixedChildStructure(children: VisualNode[]): boolean {
  const kinds = new Set(children.map((child) => child.kind));
  return kinds.size >= 2;
}

function hasVisibleSurface(node: VisualNode): boolean {
  const background = node.computed.backgroundColor?.trim().toLowerCase() ?? "";
  if (!background || background === "transparent" || background === "rgba(0, 0, 0, 0)") {
    return false;
  }

  return true;
}

function hasRoundedSurface(node: VisualNode): boolean {
  return parsePixelValue(node.computed.borderRadius) > 0;
}

function childrenFitInsideWithPadding(
  containerRect: MeasurementRect,
  children: VisualNode[],
): boolean {
  const union = unionRect(children.map((child) => child.rect));
  if (!union) {
    return false;
  }

  if (!containsRect(containerRect, union)) {
    return false;
  }

  const horizontalPadding =
    containerRect.width - union.width;
  const verticalPadding =
    containerRect.height - union.height;

  return horizontalPadding >= 8 || verticalPadding >= 8;
}

function areChildrenAligned(children: VisualNode[]): boolean {
  if (children.length < 2) {
    return false;
  }

  const first = children[0];
  if (!first) {
    return false;
  }

  const leftAligned = children.every(
    (child) => Math.abs(child.rect.x - first.rect.x) <= 12,
  );
  const topAligned = children.every(
    (child) => Math.abs(child.rect.y - first.rect.y) <= 12,
  );
  const stacked = children.every(
    (child, index) =>
      index === 0 || Math.abs(child.rect.x - first.rect.x) <= 24,
  );

  return leftAligned || topAligned || stacked;
}

function unionRect(rects: MeasurementRect[]): MeasurementRect | null {
  if (rects.length === 0) {
    return null;
  }

  const first = rects[0];
  if (!first) {
    return null;
  }

  let left = first.x;
  let top = first.y;
  let right = first.x + first.width;
  let bottom = first.y + first.height;

  for (const rect of rects.slice(1)) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function parsePixelValue(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const match = /^([\d.]+)px$/i.exec(value.trim());
  if (!match?.[1]) {
    return 0;
  }

  return Number.parseFloat(match[1]);
}
