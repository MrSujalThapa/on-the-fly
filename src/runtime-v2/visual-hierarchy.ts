import {
  isInteractiveControlRole,
  isInteractiveGroupContainer,
} from "../editor/dom/interactive-safety.js";
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
    // `display: contents` and other boxless nodes appear in the hit path but own
    // no geometry, so they can never be the object the user clicked.
    hasVisibleBox(element) &&
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

function hasOwnPaint(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return false;
  const background = style.backgroundColor;
  if (background && background !== "transparent" && background !== "rgba(0, 0, 0, 0)") {
    return true;
  }
  if (style.backgroundImage && style.backgroundImage !== "none") {
    return true;
  }
  if (style.boxShadow && style.boxShadow !== "none") {
    return true;
  }
  return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
    .some((width) => Number.parseFloat(width) > 0);
}

function isReplacedVisual(element: HTMLElement): boolean {
  return ["img", "video", "canvas", "svg", "iframe", "picture", "object", "embed", "audio"]
    .includes(element.tagName.toLowerCase());
}

function isSemanticVisual(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  return /^h[1-6]$/.test(tag) ||
    ["header", "footer", "nav", "main", "aside", "article", "figure", "table"].includes(tag);
}

function isInteractiveVisualControl(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === "a") {
    return element.hasAttribute("href");
  }
  if (["button", "input", "select", "textarea", "summary"].includes(tag)) {
    return true;
  }
  return isInteractiveControlRole(element);
}

function containsRect(parent: DOMRect, child: DOMRect, slop = 1): boolean {
  return child.left >= parent.left - slop &&
    child.right <= parent.right + slop &&
    child.top >= parent.top - slop &&
    child.bottom <= parent.bottom + slop;
}

/**
 * A control's own text/line box may legitimately overflow the control box
 * (fixed-height pills, tight line-height). Ownership is therefore decided by the
 * fragment's centre rather than full containment, which still rejects genuinely
 * escaping subtrees such as absolutely positioned popovers.
 */
function ownsFragment(parent: DOMRect, fragment: DOMRect): boolean {
  if (containsRect(parent, fragment)) {
    return true;
  }
  const centerX = fragment.left + fragment.width / 2;
  const centerY = fragment.top + fragment.height / 2;
  return centerX >= parent.left - 1 && centerX <= parent.right + 1 &&
    centerY >= parent.top - 1 && centerY <= parent.bottom + 1;
}

/**
 * True when the hit node is only a text/line-box implementation fragment, not
 * the visual object the user actually clicked.
 */
function isLineBoxFragment(element: HTMLElement): boolean {
  if (isInteractiveVisualControl(element) || isInteractiveGroupContainer(element)) {
    return false;
  }
  if (isReplacedVisual(element) || isSemanticVisual(element)) {
    return false;
  }
  if (hasOwnPaint(element)) {
    return false;
  }
  const visibleChildren = Array.from(element.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && hasVisibleBox(child),
  );
  if (visibleChildren.length > 1) {
    return false;
  }
  return ["p", "span", "div", "em", "strong", "small", "b", "i", "u", "label", "cite", "time", "code"]
    .includes(element.tagName.toLowerCase());
}

/**
 * Promote a line-box fragment to the nearest interactive control that owns the
 * click region. Stop before group containers, collections, and giant wrappers
 * so a pill stays a pill and a button stays a button.
 */
function nearestInteractiveVisual(element: HTMLElement): HTMLElement | null {
  const fragmentRect = element.getBoundingClientRect();
  let current = element.parentElement;
  while (current instanceof HTMLElement) {
    if (isRoot(current) || isGiantPageWrapper(current)) {
      return null;
    }
    if (isInteractiveGroupContainer(current)) {
      return null;
    }
    if (isCollection(current) && !isInteractiveVisualControl(current)) {
      return null;
    }
    if (
      isSelectable(current) &&
      isInteractiveVisualControl(current) &&
      hasVisibleBox(current) &&
      ownsFragment(current.getBoundingClientRect(), fragmentRect)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function canonicalizeClickedBinding(element: HTMLElement): HTMLElement {
  if (!isLineBoxFragment(element)) {
    return element;
  }
  return nearestInteractiveVisual(element) ?? element;
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
 * under the pointer is the editable object. Line-box/text fragments are
 * canonicalized to the nearest interactive visual control when they do not
 * themselves represent that control. Larger units are selected explicitly
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
    const binding = canonicalizeClickedBinding(candidate);
    const parent = parentDiscovery(binding);
    return {
      binding,
      role: roleFor(binding),
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
  const binding = canonicalizeClickedBinding(element);
  const parent = parentDiscovery(binding);
  return {
    binding,
    role: roleFor(binding),
    parentBinding: parent?.binding ?? null,
    parentRole: parent?.role ?? null,
  };
}
