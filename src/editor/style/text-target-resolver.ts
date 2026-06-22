import { buildPersistableElementSignature } from "../measurement/signature-builder.js";
import type { TransformTarget } from "../transform/transform-target.js";
import { isBlockedTextEditElement } from "./style-target-resolver.js";

export const MAX_NESTED_TEXT_EDIT_CHILDREN = 80;

export type TextEditRefusalReason =
  | "no-target"
  | "blocked-element"
  | "too-many-text-nodes"
  | "no-text-content"
  | "not-connected"
  | "rejected-too-large";

export interface TextEditTargetResult {
  ok: true;
  element: HTMLElement;
  target: TransformTarget;
  reason:
    | "direct-leaf"
    | "inline-promoted-to-block"
    | "single-descendant"
    | "first-descendant"
    | "selected-leaf";
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

const TEXT_BLOCK_CLASS_HINT =
  /(?:^|[-_\s])(nt-card__text|line-clamp|text|copy|body|description|headline|title|subtitle|summary|message|notification|notif)(?:[-_\s]|$)/i;

const MAX_PROMOTED_TEXT_LENGTH = 700;
const MAX_PROMOTED_DESCENDANTS = 40;

/**
 * Extracts editable text from an element by walking its text nodes in document
 * order, collapsing all whitespace/newline runs, and dropping duplicated text
 * segments (e.g. visually-hidden screen-reader copies). This keeps the editor
 * from surfacing whitespace-heavy or doubled strings such as
 * "Same copy.Same copy.".
 */
export function extractEditableText(element: HTMLElement): string {
  const segments: string[] = [];
  const seen = new Set<string>();
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const normalized = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      segments.push(normalized);
    }
    node = walker.nextNode();
  }
  return segments.join(" ").replace(/\s+/g, " ").trim();
}

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

  const first = descendants[0];
  if (first) {
    const promoted = resolvePromotedTextBlock(first, selectedElement);
    return toResult(
      promoted ?? first,
      fallbackTarget,
      promoted ? "inline-promoted-to-block" : "first-descendant",
      first,
    );
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

    const result = evaluatePromotedTextBlock(current, element);
    if (result === "safe") {
      return current;
    }

    if (stopAt && current === stopAt) {
      return null;
    }

    current = current.parentElement;
  }

  return null;
}

function evaluatePromotedTextBlock(
  candidate: HTMLElement,
  original: HTMLElement,
): "safe" | "too-large" | "unsafe" {
  if (!candidate.contains(original)) {
    return "unsafe";
  }

  const text = candidate.textContent.replace(/\s+/g, " ").trim();
  if (!text || text.length > MAX_PROMOTED_TEXT_LENGTH) {
    return "too-large";
  }

  if (candidate.querySelectorAll("*").length > MAX_PROMOTED_DESCENDANTS) {
    return "too-large";
  }

  const tag = candidate.tagName.toLowerCase();
  if (TEXT_BLOCK_TAGS.has(tag)) {
    return "safe";
  }

  if (tag === "span" || tag === "div") {
    const directText = Array.from(candidate.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (
      directText.length > 0 ||
      sentenceLike(text) ||
      hasTextBlockClassHint(candidate) ||
      hasMultipleInlineTextChildren(candidate)
    ) {
      return "safe";
    }
  }

  return "unsafe";
}

function sentenceLike(text: string): boolean {
  return /\s/.test(text) && /[.!?)]?$/.test(text);
}

function hasTextBlockClassHint(element: HTMLElement): boolean {
  const value = `${element.id} ${Array.from(element.classList).join(" ")}`;
  return TEXT_BLOCK_CLASS_HINT.test(value);
}

function hasMultipleInlineTextChildren(element: HTMLElement): boolean {
  let count = 0;
  for (const child of Array.from(element.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    const tag = child.tagName.toLowerCase();
    if (INLINE_TEXT_TAGS.has(tag) && child.textContent.trim().length > 0) {
      count += 1;
    }
  }
  return count >= 2;
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
