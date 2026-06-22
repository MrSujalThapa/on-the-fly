import type { VisualNode } from "../visual-node.js";
import type { VisualLayoutGraph } from "../visual-graph/visual-layout-graph.js";
import { isExtensionRoot, isGiantPageWrapper } from "../measurement/scan-guards.js";
import { buildDomSelectionTarget } from "./dom-rectangle-selection.js";
import { getFilteredElementsFromPoint, mapSampledElementToVisualNode } from "./rectangle-sampling.js";
import { isSelectableForInteraction } from "./selection-guards.js";
import { findNodesAtPoint } from "./point-queries.js";

export function findAnchorInComposedPath(path: EventTarget[]): HTMLAnchorElement | null {
  for (const target of path) {
    if (target instanceof HTMLAnchorElement) {
      return target;
    }
  }

  return null;
}

export function findImageInComposedPath(path: EventTarget[]): HTMLImageElement | null {
  for (const target of path) {
    if (target instanceof HTMLImageElement) {
      return target;
    }
  }

  return null;
}

export function findDirectClickableInComposedPath(path: EventTarget[]): HTMLElement | null {
  for (const target of path) {
    if (!(target instanceof HTMLElement)) {
      continue;
    }

    const tagName = target.tagName.toLowerCase();
    if (tagName === "button") {
      return target;
    }

    if (tagName === "input" || tagName === "textarea" || tagName === "select") {
      return target;
    }
  }

  return null;
}

export function resolveVisualNodeForElement(
  graph: VisualLayoutGraph,
  element: Element,
  x: number,
  y: number,
): VisualNode | undefined {
  const tagName = element.tagName.toLowerCase();
  const id = element.id.trim();
  const classes = new Set(Array.from(element.classList));
  const hits = findNodesAtPoint(graph.getNodes(), x, y);

  if (hits.length > 0) {
    const matchedHit = findMatchingVisualNode(hits, tagName, id, classes);
    if (matchedHit) {
      return matchedHit;
    }
  }

  return findVisualNodeByElementSignature(graph.getNodes(), tagName, id, classes);
}

function findMatchingVisualNode(
  nodes: Iterable<VisualNode>,
  tagName: string,
  id: string,
  classes: Set<string>,
): VisualNode | undefined {
  for (const node of nodes) {
    if (matchesElementSignature(node, tagName, id, classes)) {
      return node;
    }
  }

  const nodesArray = Array.from(nodes);
  return nodesArray.find((node) => node.signature.tagName === tagName) ?? nodesArray[0];
}

function matchesElementSignature(
  node: VisualNode,
  tagName: string,
  id: string,
  classes: Set<string>,
): boolean {
  if (node.signature.tagName !== tagName) {
    return false;
  }

  if (id && node.signature.idAttr !== id) {
    return false;
  }

  if (
    classes.size > 0 &&
    !node.signature.classList.some((className) => classes.has(className))
  ) {
    return false;
  }

  return true;
}

function findVisualNodeByElementSignature(
  nodes: Iterable<VisualNode>,
  tagName: string,
  id: string,
  classes: Set<string>,
): VisualNode | undefined {
  let classMatch: VisualNode | undefined;
  let tagMatch: VisualNode | undefined;

  for (const node of nodes) {
    if (node.signature.tagName !== tagName) {
      continue;
    }

    tagMatch ??= node;

    if (id && node.signature.idAttr === id) {
      return node;
    }

    if (
      classes.size > 0 &&
      node.signature.classList.some((className) => classes.has(className))
    ) {
      classMatch ??= node;
    }
  }

  return classMatch ?? tagMatch;
}

export function resolveVisualNodeForAnchor(
  graph: VisualLayoutGraph,
  anchor: HTMLAnchorElement,
  x: number,
  y: number,
): VisualNode | undefined {
  const anchorNode = resolveVisualNodeForElement(graph, anchor, x, y);
  if (anchorNode) {
    return anchorNode;
  }

  const hits = findNodesAtPoint(graph.getNodes(), x, y);
  return hits.find((hit) => hit.signature.tagName === "a");
}

function resolveVisualNodeForImage(
  graph: VisualLayoutGraph,
  image: HTMLImageElement,
  x: number,
  y: number,
): VisualNode | undefined {
  const imageNode = resolveVisualNodeForElement(graph, image, x, y);
  if (imageNode && isSelectableForInteraction(imageNode)) {
    return imageNode;
  }

  const node = buildDomSelectionTarget(image, "otf-click-img", graph.getViewport());
  return isSelectableForInteraction(node) ? node : undefined;
}

export function shouldSkipContainerPromotion(
  node: VisualNode,
  path: EventTarget[],
): boolean {
  if (node.kind === "button" || node.kind === "input") {
    return true;
  }

  if (node.signature.tagName === "a") {
    return true;
  }

  if (findAnchorInComposedPath(path)) {
    return node.signature.tagName === "a" || node.kind === "text" || node.kind === "image";
  }

  if (findDirectClickableInComposedPath(path)) {
    return true;
  }

  return false;
}

const DIRECT_CLICKABLE_TAGS = new Set(["a", "button", "input", "textarea", "select"]);

function findDirectClickableAncestor(element: Element): Element | null {
  let current: Element | null = element;
  while (current) {
    if (DIRECT_CLICKABLE_TAGS.has(current.tagName.toLowerCase())) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

export function resolveClickTargetFromElementsFromPoint(
  document: Document,
  graph: VisualLayoutGraph,
  x: number,
  y: number,
): VisualNode | undefined {
  const viewport = graph.getViewport();
  const elements = getFilteredElementsFromPoint(document, x, y, viewport);
  const seenTargets = new Set<Element>();

  for (const element of elements) {
    if (element instanceof HTMLImageElement) {
      const imageNode = resolveVisualNodeForImage(graph, element, x, y);
      if (imageNode) {
        return imageNode;
      }
    }

    const target = findDirectClickableAncestor(element) ?? element;
    if (seenTargets.has(target)) {
      continue;
    }

    seenTargets.add(target);

    if (target instanceof HTMLAnchorElement) {
      const anchorNode = resolveVisualNodeForAnchor(graph, target, x, y);
      if (anchorNode && isSelectableForInteraction(anchorNode)) {
        return anchorNode;
      }
    }

    if (
      target instanceof HTMLButtonElement ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      const clickableNode = resolveVisualNodeForElement(graph, target, x, y);
      if (clickableNode && isSelectableForInteraction(clickableNode)) {
        return clickableNode;
      }
    }

    const node = mapSampledElementToVisualNode(graph, target, x, y);
    if (node) {
      return node;
    }
  }

  return undefined;
}

export function resolveClickTargetNode(
  graph: VisualLayoutGraph,
  x: number,
  y: number,
  composedPath: EventTarget[] = [],
  document?: Document,
): VisualNode | undefined {
  if (document) {
    const fromPoint = resolveClickTargetFromElementsFromPoint(document, graph, x, y);
    if (fromPoint) {
      return fromPoint;
    }
  }

  const anchor = findAnchorInComposedPath(composedPath);
  const image = findImageInComposedPath(composedPath);
  if (image) {
    const imageNode = resolveVisualNodeForImage(graph, image, x, y);
    if (imageNode) {
      return imageNode;
    }
  }

  if (anchor) {
    const anchorNode = resolveVisualNodeForAnchor(graph, anchor, x, y);
    if (anchorNode) {
      return anchorNode;
    }
  }

  const clickable = findDirectClickableInComposedPath(composedPath);
  if (clickable) {
    const clickableNode = resolveVisualNodeForElement(graph, clickable, x, y);
    if (clickableNode) {
      return clickableNode;
    }
  }

  return findNodesAtPoint(graph.getNodes(), x, y)[0];
}

/**
 * Collects the page elements stacked under the cursor, ordered deepest child
 * first up through meaningful ancestors. Stops at `html`/`body`, the extension
 * overlay, and giant page wrappers so Alt+Click can never escape to page-level
 * nodes. Uses the event composed path when available (most reliable, including
 * nested anchors), falling back to `document.elementsFromPoint`.
 */
function collectAltClickElements(
  graph: VisualLayoutGraph,
  x: number,
  y: number,
  composedPath: EventTarget[],
  document?: Document,
): Element[] {
  const viewport = graph.getViewport();
  const fromPath = composedPath.filter(
    (target): target is Element => target instanceof Element,
  );
  const ordered =
    fromPath.length > 0
      ? fromPath
      : document
        ? getFilteredElementsFromPoint(document, x, y, viewport)
        : [];

  const elements: Element[] = [];
  for (const element of ordered) {
    const tagName = element.tagName.toLowerCase();
    if (tagName === "html" || tagName === "body") {
      break;
    }

    if (isExtensionRoot(element)) {
      continue;
    }

    if (isGiantPageWrapper(element, viewport)) {
      break;
    }

    elements.push(element);
  }

  return elements;
}

/**
 * Builds the Alt+Click target chain: the direct/deeper child under the cursor
 * first, then its selectable ancestors (parent, container). Repeated Alt+Click
 * cycles through this chain so users can reach a child inside an anchor/link
 * that normal click would resolve to the parent link/container.
 */
export function buildAltClickChain(
  graph: VisualLayoutGraph,
  x: number,
  y: number,
  composedPath: EventTarget[] = [],
  document?: Document,
): VisualNode[] {
  const viewport = graph.getViewport();
  const elements = collectAltClickElements(graph, x, y, composedPath, document);
  const chain: VisualNode[] = [];

  elements.forEach((element, index) => {
    // DOM-first: build the target from the exact element under the cursor so
    // the child (ad title/image) resolves precisely instead of snapping to a
    // graph node for a different element. Keeps the live element reference so
    // transforms/hide act on exactly what was Alt+Clicked.
    const node = buildDomSelectionTarget(element, `otf-alt-${String(index)}`, viewport);
    if (isSelectableForInteraction(node)) {
      chain.push(node);
    }
  });

  return chain;
}
