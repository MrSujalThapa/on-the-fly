import type { VisualNodeKind } from "../visual-node.js";
import { CONTAINER_TAG_NAMES, TEXT_LIKE_TAG_NAMES } from "./constants.js";

function normalizeTagName(element: Element): string {
  return element.tagName.toLowerCase();
}

function getInputType(element: Element): string {
  if (!(element instanceof HTMLInputElement)) {
    return "";
  }

  return element.type.trim().toLowerCase();
}

function hasDirectTextContent(element: Element): boolean {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      return true;
    }
  }

  return false;
}

function isButtonLike(element: Element): boolean {
  const tagName = normalizeTagName(element);

  if (tagName === "button") {
    return true;
  }

  if (element.getAttribute("role") === "button") {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    const type = getInputType(element);
    return type === "button" || type === "submit" || type === "reset";
  }

  return false;
}

function isInputLike(element: Element): boolean {
  const tagName = normalizeTagName(element);

  if (tagName === "textarea" || tagName === "select") {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    const type = getInputType(element);
    return type !== "button" && type !== "submit" && type !== "reset" && type !== "hidden";
  }

  return false;
}

function isImageLike(element: Element): boolean {
  const tagName = normalizeTagName(element);
  return tagName === "img" || tagName === "picture" || tagName === "video";
}

function isContainerLike(element: Element): boolean {
  const tagName = normalizeTagName(element);

  if (CONTAINER_TAG_NAMES.has(tagName)) {
    return element.children.length > 0;
  }

  return element.children.length > 0 && !hasDirectTextContent(element);
}

function isTextLike(element: Element): boolean {
  const tagName = normalizeTagName(element);

  if (isButtonLike(element) || isInputLike(element) || isImageLike(element)) {
    return false;
  }

  if (TEXT_LIKE_TAG_NAMES.has(tagName) && hasDirectTextContent(element)) {
    return true;
  }

  return hasDirectTextContent(element) && element.children.length === 0;
}

export function detectElementKind(element: Element): VisualNodeKind {
  if (isImageLike(element)) {
    return "image";
  }

  if (isButtonLike(element)) {
    return "button";
  }

  if (isInputLike(element)) {
    return "input";
  }

  if (isTextLike(element)) {
    return "text";
  }

  if (isContainerLike(element)) {
    return "container";
  }

  return "unknown";
}

export function isLikelyContainer(element: Element, kind: VisualNodeKind): boolean {
  if (kind === "container") {
    return true;
  }

  return element.children.length > 0 && kind !== "text" && kind !== "image";
}
