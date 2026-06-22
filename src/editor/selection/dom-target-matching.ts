import type { VisualNode } from "../visual-node.js";
import type { VisualLayoutGraph } from "../visual-graph/visual-layout-graph.js";
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
    return node.signature.tagName === "a" || node.kind === "text";
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
