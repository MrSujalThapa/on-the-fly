import {
  isExtensionRoot,
  isGiantPageWrapper,
  shouldExcludeFromMeasurement,
} from "../editor/measurement/scan-guards.js";
import { TEXT_LIKE_TAG_NAMES } from "../editor/measurement/constants.js";

function isTextLeaf(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (TEXT_LIKE_TAG_NAMES.has(tag) && tag !== "a" && tag !== "label" && tag !== "li") {
    return true;
  }
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return false;
  }
  const display = view.getComputedStyle(element).display;
  return display === "inline" || display === "contents";
}

function promoteFromTextLeaf(element: HTMLElement): HTMLElement {
  let current = element;
  while (current.parentElement instanceof HTMLElement) {
    const parent = current.parentElement;
    if (shouldExcludeFromMeasurement(parent) || isGiantPageWrapper(parent) || isExtensionRoot(parent)) {
      break;
    }
    if (!isTextLeaf(current)) {
      break;
    }
    current = parent;
  }
  return current;
}

export function hitElementAt(document: Document, clientX: number, clientY: number): HTMLElement | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (isExtensionRoot(node) || shouldExcludeFromMeasurement(node)) {
      continue;
    }
    return promoteFromTextLeaf(node);
  }
  return null;
}
