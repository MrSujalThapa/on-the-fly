import type { MatchViewport } from "../dom/types.js";
import { getMatchViewport } from "../dom/signature-matcher.js";
import { extractBoundingBox, isZeroSizeRect } from "../measurement/bounding-box.js";
import { MIN_VISIBLE_SIZE_PX } from "../measurement/constants.js";
import { shouldExcludeFromMeasurement } from "../measurement/scan-guards.js";
import type { MeasurementRect } from "../measurement/types.js";
import type { VisualNodeId } from "../ids.js";
import type { VisualNode } from "../visual-node.js";
import { promoteSelectionTarget } from "../visual-graph/container-detection.js";
import type { VisualLayoutGraph } from "../visual-graph/visual-layout-graph.js";
import { resolveVisualNodeForElement } from "./dom-target-matching.js";
import { isSelectableForInteraction } from "./selection-guards.js";

export const RECT_SAMPLE_SPACING_PX = 16;
export const RECT_SAMPLE_INSET_PX = 1;
export const MIN_RECT_SAMPLE_COUNT = 4;
export const MAX_RECT_SAMPLE_COUNT = 64;
export const MIN_LASSO_SAMPLE_SIZE_PX = MIN_VISIBLE_SIZE_PX;

export interface SamplePoint {
  x: number;
  y: number;
}

export function buildRectangleSampleGrid(rect: MeasurementRect): SamplePoint[] {
  const left = rect.x + RECT_SAMPLE_INSET_PX;
  const top = rect.y + RECT_SAMPLE_INSET_PX;
  const right = Math.max(left, rect.x + rect.width - RECT_SAMPLE_INSET_PX);
  const bottom = Math.max(top, rect.y + rect.height - RECT_SAMPLE_INSET_PX);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return [
      {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      },
    ];
  }

  let cols = Math.max(2, Math.ceil(width / RECT_SAMPLE_SPACING_PX) + 1);
  let rows = Math.max(2, Math.ceil(height / RECT_SAMPLE_SPACING_PX) + 1);

  while (cols * rows > MAX_RECT_SAMPLE_COUNT) {
    if (cols >= rows && cols > 2) {
      cols -= 1;
    } else if (rows > 2) {
      rows -= 1;
    } else {
      break;
    }
  }

  while (cols * rows < MIN_RECT_SAMPLE_COUNT && (cols < 12 || rows < 12)) {
    if (cols <= rows) {
      cols += 1;
    } else {
      rows += 1;
    }
  }

  const stepX = cols <= 1 ? 0 : width / (cols - 1);
  const stepY = rows <= 1 ? 0 : height / (rows - 1);
  const points: SamplePoint[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      points.push({
        x: left + stepX * col,
        y: top + stepY * row,
      });
    }
  }

  return points;
}

export function isVisibleEnoughForLassoSample(element: Element): boolean {
  const rect = extractBoundingBox(element);
  if (isZeroSizeRect(rect)) {
    return false;
  }

  if (rect.width < MIN_LASSO_SAMPLE_SIZE_PX || rect.height < MIN_LASSO_SAMPLE_SIZE_PX) {
    return false;
  }

  const view = element.ownerDocument.defaultView;
  if (!view) {
    return true;
  }

  const style = view.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const opacity = Number.parseFloat(style.opacity);
  if (Number.isFinite(opacity) && opacity <= 0) {
    return false;
  }

  return true;
}

export function isSelectableLassoSampleElement(
  element: Element,
  viewport: MatchViewport = getMatchViewport(element.ownerDocument),
): boolean {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "html" || tagName === "body") {
    return false;
  }

  if (shouldExcludeFromMeasurement(element, { viewport })) {
    return false;
  }

  return isVisibleEnoughForLassoSample(element);
}

export function getFilteredElementsFromPoint(
  document: Document,
  x: number,
  y: number,
  viewport: MatchViewport,
): Element[] {
  const raw = document.elementsFromPoint(x, y);
  const seen = new Set<Element>();
  const filtered: Element[] = [];

  for (const target of raw) {
    if (!(target instanceof Element) || seen.has(target)) {
      continue;
    }

    seen.add(target);
    if (isSelectableLassoSampleElement(target, viewport)) {
      filtered.push(target);
    }
  }

  return filtered;
}

function promoteLassoSampleNode(
  node: VisualNode,
  nodes: ReadonlyMap<VisualNodeId, VisualNode>,
  viewport: MatchViewport,
): VisualNode {
  if (node.kind === "button" || node.kind === "input" || node.signature.tagName === "a") {
    return node;
  }

  return promoteSelectionTarget(node, nodes, viewport);
}

/**
 * Maps a single sampled DOM element to a VisualNode. Used by click selection,
 * which is allowed to depend on the graph. Rectangle selection does NOT use
 * this path (see dom-rectangle-selection.ts).
 */
export function mapSampledElementToVisualNode(
  graph: VisualLayoutGraph,
  element: Element,
  x: number,
  y: number,
): VisualNode | undefined {
  const node = resolveVisualNodeForElement(graph, element, x, y);
  if (!node || !isSelectableForInteraction(node)) {
    return undefined;
  }

  return promoteLassoSampleNode(node, graph.toSnapshot().nodes, graph.getViewport());
}
