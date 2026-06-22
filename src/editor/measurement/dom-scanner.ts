import type { VisualNodeId } from "../ids.js";
import type { VisualNode } from "../visual-node.js";
import { getMatchViewport } from "../dom/signature-matcher.js";
import {
  shouldExcludeFromMeasurement,
  shouldSkipSubtree,
} from "./scan-guards.js";
import { isElementVisible } from "./visibility.js";
import {
  buildVisualNodeFromElement,
  createMeasurementContext,
} from "./visual-node-builder.js";
import type { ScanOptions, VisualNodeBuildResult } from "./types.js";

function getDefaultScanRoot(root: ParentNode): Element {
  if ("body" in root && root.body instanceof Element) {
    return root.body;
  }

  if (root instanceof Element) {
    return root;
  }

  throw new Error("scanVisualNodes requires a Document or Element scan root");
}

function walkElementTree(
  element: Element,
  parentId: VisualNodeId | undefined,
  context: ReturnType<typeof createMeasurementContext>,
  nodes: Map<VisualNodeId, VisualNode>,
  rootNodeIds: VisualNodeId[],
): void {
  if (shouldSkipSubtree(element)) {
    return;
  }

  if (
    shouldExcludeFromMeasurement(element, {
      viewport: context.viewport,
    })
  ) {
    for (const child of Array.from(element.children)) {
      walkElementTree(child, parentId, context, nodes, rootNodeIds);
    }
    return;
  }

  if (!isElementVisible(element)) {
    for (const child of Array.from(element.children)) {
      walkElementTree(child, parentId, context, nodes, rootNodeIds);
    }
    return;
  }

  const node = buildVisualNodeFromElement(element, context, parentId);
  nodes.set(node.id, node);

  if (parentId) {
    const parentNode = nodes.get(parentId);
    if (parentNode) {
      parentNode.childIds.push(node.id);
    }
  } else {
    rootNodeIds.push(node.id);
  }

  for (const child of Array.from(element.children)) {
    walkElementTree(child, node.id, context, nodes, rootNodeIds);
  }
}

export function scanVisualNodes(
  root: ParentNode,
  options: ScanOptions = {},
): VisualNodeBuildResult {
  const scanRoot = options.scanRoot ?? getDefaultScanRoot(root);
  if (!(scanRoot instanceof Element)) {
    throw new Error("scanVisualNodes requires an Element scan root");
  }

  const viewport = options.viewport ?? getMatchViewport(root);
  const context = createMeasurementContext(scanRoot);
  context.viewport = viewport;

  const nodes = new Map<VisualNodeId, VisualNode>();
  const rootNodeIds: VisualNodeId[] = [];

  walkElementTree(
    scanRoot,
    undefined,
    context,
    nodes,
    rootNodeIds,
  );

  return { nodes, rootNodeIds };
}

export function buildVisualNodeMapFromElements(
  elements: Element[],
  scanRoot: ParentNode,
): VisualNodeBuildResult {
  const context = createMeasurementContext(scanRoot);
  const nodes = new Map<VisualNodeId, VisualNode>();
  const rootNodeIds: VisualNodeId[] = [];

  for (const element of elements) {
    if (
      shouldExcludeFromMeasurement(element, { viewport: context.viewport }) ||
      !isElementVisible(element)
    ) {
      continue;
    }

    const node = buildVisualNodeFromElement(element, context);
    nodes.set(node.id, node);
    rootNodeIds.push(node.id);
  }

  return { nodes, rootNodeIds };
}
