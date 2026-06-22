import type { VisualNodeId } from "../ids.js";
import type { VisualNode } from "../visual-node.js";
import { getMatchViewport } from "../dom/signature-matcher.js";
import { extractBoundingBox, rectToVisualNodeRect } from "./bounding-box.js";
import { snapshotComputedStyles } from "./computed-styles.js";
import { detectElementKind, isLikelyContainer } from "./element-kind.js";
import { buildElementSignature } from "./signature-builder.js";
import { getViewportAreaRatio, isGiantPageWrapper } from "./scan-guards.js";
import type { MeasurementContext } from "./types.js";

export function createVisualNodeId(index: number): VisualNodeId {
  return `otf-vn-${String(index)}`;
}

export function buildVisualNodeFromElement(
  element: Element,
  context: MeasurementContext,
  parentId?: VisualNodeId,
): VisualNode {
  const rect = extractBoundingBox(element);
  const kind = detectElementKind(element);
  const id = createVisualNodeId(context.nextNodeIndex);
  context.nextNodeIndex += 1;

  const node: VisualNode = {
    id,
    kind,
    signature: buildElementSignature(element, {
      root: context.scanRoot,
      viewport: context.viewport,
    }),
    rect: rectToVisualNodeRect(rect),
    computed: snapshotComputedStyles(element),
    childIds: [],
    isLikelyContainer: isLikelyContainer(element, kind),
    isPageLevel: isGiantPageWrapper(element, context.viewport),
  };

  if (parentId) {
    node.parentId = parentId;
  }

  if (getViewportAreaRatio(rect, context.viewport) >= 0.75) {
    node.isPageLevel = true;
  }

  return node;
}

export function createMeasurementContext(scanRoot: ParentNode): MeasurementContext {
  return {
    scanRoot,
    viewport: getMatchViewport(scanRoot),
    nextNodeIndex: 0,
  };
}
