import type { MatchViewport } from "../dom/types.js";
import { rectArea } from "../measurement/geometry.js";
import type { MeasurementRect } from "../measurement/types.js";
import { GIANT_NODE_AREA_RATIO } from "../measurement/constants.js";
import type { VisualNode } from "../visual-node.js";

export const MAX_LASSO_VIEWPORT_COVERAGE = 0.88;
export const MAX_LASSO_SELECTION_RATIO = 0.75;

export function isBlockedSelectionNode(node: VisualNode): boolean {
  if (node.isPageLevel) {
    return true;
  }

  const tagName = node.signature.tagName.toLowerCase();
  return tagName === "html" || tagName === "body";
}

export function isSelectableForInteraction(node: VisualNode): boolean {
  return !isBlockedSelectionNode(node);
}

export function isWholePageLassoRect(
  lassoRect: MeasurementRect,
  viewport: MatchViewport,
): boolean {
  const viewportArea = Math.max(1, viewport.width * viewport.height);
  return rectArea(lassoRect) / viewportArea >= MAX_LASSO_VIEWPORT_COVERAGE;
}

export function isWholePageSelection(
  selectedNodes: VisualNode[],
  selectableNodes: VisualNode[],
  lassoRect: MeasurementRect | null,
  viewport: MatchViewport,
): boolean {
  const viewportArea = Math.max(1, viewport.width * viewport.height);

  if (lassoRect && isWholePageLassoRect(lassoRect, viewport)) {
    return true;
  }

  if (selectableNodes.length === 0) {
    return false;
  }

  if (selectedNodes.some((node) => node.isPageLevel)) {
    return true;
  }

  const ratio = selectedNodes.length / selectableNodes.length;
  const lassoCoverage = lassoRect ? rectArea(lassoRect) / viewportArea : 0;

  if (lassoRect && lassoCoverage >= 0.45 && ratio >= MAX_LASSO_SELECTION_RATIO) {
    return true;
  }

  if (!lassoRect && ratio >= MAX_LASSO_SELECTION_RATIO) {
    return true;
  }

  const selectedArea = selectedNodes.reduce((sum, node) => sum + rectArea(node.rect), 0);
  if (selectedArea / viewportArea >= GIANT_NODE_AREA_RATIO) {
    return true;
  }

  return false;
}

export function filterInteractiveNodes(nodes: Iterable<VisualNode>): VisualNode[] {
  return Array.from(nodes).filter((node) => isSelectableForInteraction(node));
}
