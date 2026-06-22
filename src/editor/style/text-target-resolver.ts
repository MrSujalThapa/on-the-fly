import { buildPersistableElementSignature } from "../measurement/signature-builder.js";
import type { TransformTarget } from "../transform/transform-target.js";
import { isBlockedTextEditElement } from "./style-target-resolver.js";

export const MAX_NESTED_TEXT_EDIT_CHILDREN = 80;

export type TextEditRefusalReason =
  | "no-target"
  | "blocked-element"
  | "too-many-text-nodes"
  | "no-text-content"
  | "not-connected";

export interface TextEditTargetResult {
  ok: true;
  element: HTMLElement;
  target: TransformTarget;
}

export interface TextEditRefusal {
  ok: false;
  reason: TextEditRefusalReason;
  detail?: string;
}

export type TextEditResolution = TextEditTargetResult | TextEditRefusal;

const TEXT_LIKE_TAGS = new Set([
  "p",
  "span",
  "a",
  "button",
  "label",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "td",
  "th",
  "strong",
  "em",
  "b",
  "i",
  "small",
  "div",
]);

export function resolveTextEditTargetAtPoint(
  document: Document,
  clientX: number,
  clientY: number,
  selectedElement: HTMLElement | null,
  fallbackTarget: TransformTarget | null = null,
): TextEditResolution {
  const hit = findTextElementAtPoint(document, clientX, clientY);
  if (hit) {
    return toResult(hit, fallbackTarget);
  }

  if (selectedElement?.isConnected) {
    const nested = findNestedTextAtPoint(selectedElement, clientX, clientY);
    if (nested) {
      return toResult(nested, fallbackTarget);
    }

    if (isEditableLeaf(selectedElement)) {
      return toResult(selectedElement, fallbackTarget);
    }
  }

  return { ok: false, reason: "no-target" };
}

export function resolveTextEditTargetForSelection(
  document: Document,
  selectedElement: HTMLElement | null,
  fallbackTarget: TransformTarget | null = null,
): TextEditResolution {
  if (!selectedElement?.isConnected) {
    return { ok: false, reason: "not-connected" };
  }

  if (isEditableLeaf(selectedElement)) {
    return toResult(selectedElement, fallbackTarget);
  }

  const descendants = collectEditableTextLeaves(selectedElement);
  if (descendants.length === 1) {
    const only = descendants[0];
    if (only) {
      return toResult(only, fallbackTarget);
    }
  }

  if (descendants.length > MAX_NESTED_TEXT_EDIT_CHILDREN) {
    return {
      ok: false,
      reason: "too-many-text-nodes",
      detail: String(descendants.length),
    };
  }

  return { ok: false, reason: "no-target", detail: "select-specific-text" };
}

function findTextElementAtPoint(
  document: Document,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (!(node instanceof HTMLElement) || isBlockedTextEditElement(node)) {
      continue;
    }
    if (isEditableLeaf(node)) {
      return node;
    }
    const nested = findNestedTextAtPoint(node, clientX, clientY);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function findNestedTextAtPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const descendants = collectEditableTextLeaves(root);
  if (descendants.length > MAX_NESTED_TEXT_EDIT_CHILDREN) {
    return null;
  }

  for (const element of descendants) {
    const rect = element.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return element;
    }
  }

  return null;
}

function collectEditableTextLeaves(root: HTMLElement): HTMLElement[] {
  const results: HTMLElement[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node instanceof HTMLElement && isEditableLeaf(node)) {
      results.push(node);
    }
    node = walker.nextNode();
  }
  return results;
}

function isEditableLeaf(element: HTMLElement): boolean {
  if (isBlockedTextEditElement(element)) {
    return false;
  }
  if (element.children.length > 0) {
    return false;
  }
  if (element.textContent.trim().length === 0) {
    return false;
  }
  const tag = element.tagName.toLowerCase();
  return TEXT_LIKE_TAGS.has(tag) || element.getAttribute("role") === "textbox";
}

function toResult(
  element: HTMLElement,
  fallback: TransformTarget | null,
): TextEditResolution {
  if (isBlockedTextEditElement(element)) {
    return { ok: false, reason: "blocked-element", detail: element.tagName.toLowerCase() };
  }
  if (!element.isConnected) {
    return { ok: false, reason: "not-connected" };
  }
  if (element.textContent.trim().length === 0) {
    return { ok: false, reason: "no-text-content" };
  }

  const rect = element.getBoundingClientRect();
  return {
    ok: true,
    element,
    target: {
      nodeId: fallback?.nodeId ?? "text-edit",
      signature: buildPersistableElementSignature(element),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      element,
    },
  };
}
