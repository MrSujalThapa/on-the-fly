import {
  isExtensionRoot,
  isGiantPageWrapper,
  shouldExcludeFromMeasurement,
} from "../editor/measurement/scan-guards.js";
import type { VisualRole } from "./visual-model.js";

export interface VisualDiscovery {
  readonly binding: HTMLElement;
  readonly role: VisualRole;
  readonly parentBinding: HTMLElement | null;
  readonly parentRole: VisualRole | null;
}

function isRoot(element: HTMLElement): boolean {
  return element === element.ownerDocument.body ||
    element === element.ownerDocument.documentElement;
}

function hasVisibleBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

function isSelectable(element: HTMLElement): boolean {
  return !isRoot(element) &&
    !isExtensionRoot(element) &&
    !isGiantPageWrapper(element) &&
    !shouldExcludeFromMeasurement(element, { includePageLevel: true });
}

function isPaintlessLayoutWrapper(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (!["aside", "div", "main", "section"].includes(tag) || element.children.length === 0) {
    return false;
  }
  const ownText = Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .some((node) => Boolean(node.textContent?.trim()));
  if (ownText) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return false;
  return (style.backgroundColor === "transparent" || style.backgroundColor === "rgba(0, 0, 0, 0)") &&
    style.backgroundImage === "none" &&
    [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
      .every((width) => Number.parseFloat(width) === 0);
}

function roleFor(element: HTMLElement): VisualRole {
  if (isCollection(element)) {
    return "collection";
  }
  const tag = element.tagName.toLowerCase();
  if (tag === "main" || tag === "section" || tag === "aside" ||
      tag === "header" || tag === "footer" || tag === "nav") {
    return "section";
  }
  return "unit";
}

function stableClassKey(element: HTMLElement): string {
  return Array.from(element.classList)
    .filter((name) => !name.startsWith("otf-"))
    .slice(0, 2)
    .join(".");
}

function peerKey(element: HTMLElement): string {
  return `${element.tagName.toLowerCase()}:${stableClassKey(element)}:${element.getAttribute("role") ?? ""}`;
}

/**
 * Structural metadata for explicit parent selection only. Collection detection
 * never changes the default clicked target.
 */
export function isCollection(element: HTMLElement): boolean {
  const children = Array.from(element.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && hasVisibleBox(child));
  if (children.length < 2) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const child of children) {
    const key = peerKey(child);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(...counts.values()) >= 2;
}

function parentDiscovery(element: HTMLElement): {
  binding: HTMLElement;
  role: VisualRole;
} | null {
  let parent = element.parentElement;
  while (parent instanceof HTMLElement) {
    if (isSelectable(parent) && (!isPaintlessLayoutWrapper(parent) || isCollection(parent))) {
      return { binding: parent, role: roleFor(parent) };
    }
    parent = parent.parentElement;
  }
  return null;
}

/**
 * Runtime V2 default selection is exact: the first visible sensible HTMLElement
 * under the pointer is the editable object. Larger units are selected explicitly
 * through the parent command, never inferred from content size or tag.
 */
export function discoverFromPath(path: readonly Element[]): VisualDiscovery | null {
  for (const candidate of path) {
    if (!(candidate instanceof HTMLElement) || !isSelectable(candidate)) {
      continue;
    }
    if (isPaintlessLayoutWrapper(candidate)) {
      continue;
    }
    const parent = parentDiscovery(candidate);
    return {
      binding: candidate,
      role: roleFor(candidate),
      parentBinding: parent?.binding ?? null,
      parentRole: parent?.role ?? null,
    };
  }
  return null;
}

export function discoverFromElement(element: HTMLElement): VisualDiscovery | null {
  if (!isSelectable(element)) {
    return null;
  }
  const parent = parentDiscovery(element);
  return {
    binding: element,
    role: roleFor(element),
    parentBinding: parent?.binding ?? null,
    parentRole: parent?.role ?? null,
  };
}
