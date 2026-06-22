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
  reason: "direct-leaf" | "inline-promoted-to-block" | "single-descendant" | "selected-leaf";
  originalElement?: HTMLElement;
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

const INLINE_TEXT_TAGS = new Set([
  "span",
  "strong",
  "em",
  "a",
  "b",
  "i",
  "small",
  "mark",
  "code",
]);

const TEXT_BLOCK_TAGS = new Set([
  "p",
  "li",
  "td",
  "th",
  "button",
  "label",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "figcaption",
]);

const MAX_PROMOTED_TEXT_LENGTH = 700;
const MAX_PROMOTED_DESCENDANTS = 40;

export function resolveTextEditTargetAtPoint(
  document: Document,
  clientX: number,
  clientY: number,
  selectedElement: HTMLElement | null,
  fallbackTarget: TransformTarget | null = null,
): TextEditResolution {
  const hit = findTextElementAtPoint(document, clientX, clientY);
  if (hit) {
    const promoted = resolvePromotedTextBlock(hit);
    return toResult(
      promoted ?? hit,
      fallbackTarget,
      promoted ? "inline-promoted-to-block" : "direct-leaf",
      hit,
    );
  }

  if (selectedElement?.isConnected) {
    const nested = findNestedTextAtPoint(selectedElement, clientX, clientY);
    if (nested) {
      const promoted = resolvePromotedTextBlock(nested, selectedElement);
      return toResult(
        promoted ?? nested,
        fallbackTarget,
        promoted ? "inline-promoted-to-block" : "direct-leaf",
        nested,
      );
    }

    if (isEditableLeaf(selectedElement)) {
      return toResult(selectedElement, fallbackTarget, "selected-leaf");
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
    const promoted = resolvePromotedTextBlock(selectedElement);
    return toResult(
      promoted ?? selectedElement,
      fallbackTarget,
      promoted ? "inline-promoted-to-block" : "selected-leaf",
      selectedElement,
    );
  }

  const descendants = collectEditableTextLeaves(selectedElement);
  if (descendants.length === 1) {
    const only = descendants[0];
    if (only) {
      const promoted = resolvePromotedTextBlock(only, selectedElement);
      return toResult(
        promoted ?? only,
        fallbackTarget,
        promoted ? "inline-promoted-to-block" : "single-descendant",
        only,
      );
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

function resolvePromotedTextBlock(
  element: HTMLElement,
  stopAt?: HTMLElement,
): HTMLElement | null {
  const tag = element.tagName.toLowerCase();
  if (!INLINE_TEXT_TAGS.has(tag)) {
    return null;
  }

  let current = element.parentElement;
  while (current && current !== element.ownerDocument.body) {
    if (isBlockedTextEditElement(current)) {
      return null;
    }

    if (isSafePromotedTextBlock(current, element)) {
      return current;
    }

    if (stopAt && current === stopAt) {
      return null;
    }

    current = current.parentElement;
  }

  return null;
}

function isSafePromotedTextBlock(candidate: HTMLElement, original: HTMLElement): boolean {
  if (!candidate.contains(original)) {
    return false;
  }

  const text = candidate.textContent.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_PROMOTED_TEXT_LENGTH) {
    return false;
  }

  if (candidate.querySelectorAll("*").length > MAX_PROMOTED_DESCENDANTS) {
    return false;
  }

  const tag = candidate.tagName.toLowerCase();
  if (TEXT_BLOCK_TAGS.has(tag)) {
    return true;
  }

  if (tag === "div") {
    const directText = Array.from(candidate.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return directText.length > 0 || sentenceLike(text);
  }

  return false;
}

function sentenceLike(text: string): boolean {
  return /\s/.test(text) && /[.!?)]?$/.test(text);
}

function toResult(
  element: HTMLElement,
  fallback: TransformTarget | null,
  reason: TextEditTargetResult["reason"],
  originalElement?: HTMLElement,
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
    reason,
    ...(originalElement && originalElement !== element ? { originalElement } : {}),
    target: {
      nodeId: fallback?.nodeId ?? "text-edit",
      signature: buildPersistableElementSignature(element),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      element,
    },
  };
}
