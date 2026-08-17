import {
  isExtensionRoot,
  isGiantPageWrapper,
  shouldExcludeFromMeasurement,
} from "../editor/measurement/scan-guards.js";
import { GIANT_NODE_AREA_RATIO, TEXT_LIKE_TAG_NAMES } from "../editor/measurement/constants.js";
import { overlapArea, rectArea } from "../editor/measurement/geometry.js";
import type { VisualRole } from "./visual-model.js";

/**
 * Central visual-unit policy. Each token is a structural concept, not a site rule.
 */
export const VISUAL_POLICY = {
  /** Viewport coverage at which a node is a page/layout shell, not a default unit. */
  giantAreaRatio: GIANT_NODE_AREA_RATIO,
  /** Child fraction of parent that counts as a wrapper, not a sibling object. */
  dominantCoverage: 0.78,
  /** Parent/child overlap fraction needed to collapse a wrapper chain. */
  wrapperOverlap: 0.62,
  /** Relative size difference still allowed among repeated peers. */
  peerSizeSlack: 0.5,
  /** Similar siblings required to treat a parent as a collection. */
  minCollectionPeers: 2,
  /** Max content/control area vs unit before promoting the click to the unit. */
  contentPromoteMaxRatio: 0.6,
} as const;

export interface VisualDiscovery {
  readonly binding: HTMLElement;
  readonly role: VisualRole;
  readonly parentBinding: HTMLElement | null;
  readonly parentRole: VisualRole | null;
}

interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const STRUCTURAL_TAGS = new Set(["html", "body", "main", "header", "footer", "nav"]);
const CONTENT_TAGS = new Set([
  ...TEXT_LIKE_TAG_NAMES,
  "img",
  "picture",
  "source",
  "svg",
  "path",
  "canvas",
  "video",
  "audio",
  "i",
  "b",
  "u",
  "code",
  "time",
  "br",
]);
const CONTROL_TAGS = new Set(["button", "input", "select", "textarea", "option"]);

function readRect(element: Element): LayoutRect {
  const box = element.getBoundingClientRect();
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function hasLayout(rect: LayoutRect): boolean {
  return rect.width > 1 && rect.height > 1;
}

function viewportOf(element: Element): { width: number; height: number } {
  const view = element.ownerDocument.defaultView;
  return {
    width: view?.innerWidth ?? 1024,
    height: view?.innerHeight ?? 768,
  };
}

function isRootish(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === "html" || tag === "body";
}

function isStructuralSection(element: Element): boolean {
  return STRUCTURAL_TAGS.has(element.tagName.toLowerCase());
}

function isLayoutShell(element: HTMLElement): boolean {
  if (isRootish(element) || isGiantPageWrapper(element)) {
    return true;
  }
  const rect = readRect(element);
  const viewport = viewportOf(element);
  if (!hasLayout(rect) || viewport.width <= 0 || viewport.height <= 0) {
    return false;
  }
  const areaRatio = rectArea(rect) / (viewport.width * viewport.height);
  const wide = rect.width / viewport.width >= 0.92;
  const tall = rect.height / viewport.height >= 0.85;
  return areaRatio >= VISUAL_POLICY.giantAreaRatio || (wide && tall);
}

function isSkippable(element: Element): boolean {
  return (
    !(element instanceof HTMLElement) ||
    isExtensionRoot(element) ||
    shouldExcludeFromMeasurement(element, { includePageLevel: true })
  );
}

function visibleChildren(element: HTMLElement): HTMLElement[] {
  return Array.from(element.children).filter((child): child is HTMLElement => {
    if (isSkippable(child)) {
      return false;
    }
    const rect = readRect(child);
    return !hasLayout(rect) || (rect.width >= 2 && rect.height >= 2);
  });
}

function classToken(element: HTMLElement): string {
  return Array.from(element.classList)
    .filter((name) => !name.startsWith("otf-"))
    .slice(0, 2)
    .join(".");
}

function structuralFingerprint(element: HTMLElement): string {
  const childTags = visibleChildren(element)
    .map((child) => child.tagName.toLowerCase())
    .slice(0, 6)
    .join(",");
  return `${element.tagName.toLowerCase()}:${classToken(element)}:${childTags}`;
}

function similarSize(a: LayoutRect, b: LayoutRect): boolean {
  if (!hasLayout(a) || !hasLayout(b)) {
    return true;
  }
  const widthRatio = Math.abs(a.width - b.width) / Math.max(a.width, b.width);
  const heightRatio = Math.abs(a.height - b.height) / Math.max(a.height, b.height);
  return widthRatio <= VISUAL_POLICY.peerSizeSlack && heightRatio <= VISUAL_POLICY.peerSizeSlack;
}

function areSimilarPeers(a: HTMLElement, b: HTMLElement): boolean {
  if (a.tagName !== b.tagName) {
    return false;
  }
  if (structuralFingerprint(a) === structuralFingerprint(b)) {
    return true;
  }
  return classToken(a) === classToken(b) && similarSize(readRect(a), readRect(b));
}

export function isCollection(element: HTMLElement): boolean {
  if (isLayoutShell(element) || isRootish(element)) {
    return false;
  }
  const kids = visibleChildren(element);
  if (kids.length < VISUAL_POLICY.minCollectionPeers) {
    return false;
  }
  const groups = new Map<string, HTMLElement[]>();
  for (const child of kids) {
    const key = structuralFingerprint(child);
    const group = groups.get(key) ?? [];
    group.push(child);
    groups.set(key, group);
  }
  let largest = 0;
  for (const group of groups.values()) {
    largest = Math.max(largest, group.length);
  }
  if (largest >= VISUAL_POLICY.minCollectionPeers && largest / kids.length >= 0.5) {
    return true;
  }
  const first = kids[0];
  if (!first) {
    return false;
  }
  const similar = kids.filter((child) => areSimilarPeers(first, child)).length;
  return similar >= VISUAL_POLICY.minCollectionPeers && similar / kids.length >= 0.5;
}

function coverage(child: LayoutRect, parent: LayoutRect): number {
  if (!hasLayout(parent)) {
    return 1;
  }
  return overlapArea(child, parent) / Math.max(1, rectArea(parent));
}

function overlapFraction(a: LayoutRect, b: LayoutRect): number {
  const union = rectArea(a) + rectArea(b) - overlapArea(a, b);
  if (union <= 0) {
    return 0;
  }
  return overlapArea(a, b) / union;
}

function isInteractiveWrapper(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === "a" || tag === "label";
}

function isWrapperAround(parent: HTMLElement, child: HTMLElement): boolean {
  if (isCollection(parent) || isLayoutShell(parent) || isStructuralSection(parent)) {
    return false;
  }
  const kids = visibleChildren(parent);
  const singleChild = kids.length <= 1 || (kids.length === 1 && kids[0] === child);
  const parentRect = readRect(parent);
  const childRect = readRect(child);
  const layout = hasLayout(parentRect) && hasLayout(childRect);
  if (!layout) {
    return isInteractiveWrapper(parent) && kids.length <= 1;
  }
  const dominant = coverage(childRect, parentRect) >= VISUAL_POLICY.dominantCoverage;
  const similar = overlapFraction(parentRect, childRect) >= VISUAL_POLICY.wrapperOverlap;
  if (isInteractiveWrapper(parent) && (singleChild || dominant)) {
    return true;
  }
  return singleChild && dominant && similar;
}

function hasVisibleSurface(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return false;
  }
  const style = view.getComputedStyle(element);
  const background = style.backgroundColor.trim().toLowerCase();
  const image = style.backgroundImage.trim();
  const radius = style.borderRadius;
  const shadow = style.boxShadow;
  const border = `${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth}`;
  const painted =
    Boolean(background) && background !== "transparent" && background !== "rgba(0, 0, 0, 0)";
  return (
    painted ||
    (image !== "none" && image.length > 0) ||
    (Boolean(radius) && radius !== "0px") ||
    (Boolean(shadow) && shadow !== "none") ||
    /\d/.test(border)
  );
}

function isContentLike(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (CONTENT_TAGS.has(tag) && tag !== "a" && tag !== "label" && tag !== "li") {
    return true;
  }
  if (CONTROL_TAGS.has(tag)) {
    return true;
  }
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return false;
  }
  const display = view.getComputedStyle(element).display;
  return display === "inline" || display === "contents" || display === "inline-block" && CONTROL_TAGS.has(tag);
}

function looksLikeUnit(element: HTMLElement): boolean {
  if (isCollection(element) || isLayoutShell(element) || isRootish(element)) {
    return false;
  }
  if (element.parentElement instanceof HTMLElement && isCollection(element.parentElement)) {
    return true;
  }
  const tag = element.tagName.toLowerCase();
  if (tag === "article" || tag === "li" || tag === "figure" || tag === "aside") {
    return true;
  }
  const kids = visibleChildren(element);
  if (kids.length >= 2) {
    return true;
  }
  return hasVisibleSurface(element);
}

function findCollectionChildAncestor(hit: HTMLElement): HTMLElement | null {
  let current = hit;
  while (current.parentElement instanceof HTMLElement) {
    const parent = current.parentElement;
    if (isCollection(parent)) {
      return current;
    }
    if (isLayoutShell(parent) || isRootish(parent)) {
      return null;
    }
    current = parent;
  }
  return null;
}

function canonicalUnitBinding(start: HTMLElement): HTMLElement {
  let current = start;
  while (current.parentElement instanceof HTMLElement) {
    const parent = current.parentElement;
    if (isLayoutShell(parent) || isRootish(parent) || isCollection(parent)) {
      break;
    }
    if (isStructuralSection(parent) && !isWrapperAround(parent, current)) {
      break;
    }
    if (isWrapperAround(parent, current)) {
      current = parent;
      continue;
    }
    break;
  }
  return current;
}

function shouldStopClimb(parent: HTMLElement): boolean {
  return isLayoutShell(parent) || isRootish(parent) || (isStructuralSection(parent) && !isCollection(parent));
}

function nearestUnit(hit: HTMLElement): HTMLElement | null {
  const collectionChild = findCollectionChildAncestor(hit);
  if (collectionChild) {
    const unit = canonicalUnitBinding(collectionChild);
    return isLayoutShell(unit) ? null : unit;
  }

  let current = hit;
  while (current.parentElement instanceof HTMLElement) {
    const parent = current.parentElement;
    if (shouldStopClimb(parent)) {
      break;
    }
    if (looksLikeUnit(current) && !isWrapperAround(parent, current) && !isCollection(parent)) {
      break;
    }
    const parentRect = readRect(parent);
    const childRect = readRect(current);
    const smallContent =
      hasLayout(parentRect) &&
      hasLayout(childRect) &&
      rectArea(childRect) / Math.max(1, rectArea(parentRect)) <= VISUAL_POLICY.contentPromoteMaxRatio;
    if ((isContentLike(current) || smallContent) && (looksLikeUnit(parent) || isWrapperAround(parent, current))) {
      current = parent;
      continue;
    }
    if (isContentLike(current) && !looksLikeUnit(current)) {
      current = parent;
      continue;
    }
    break;
  }

  const unit = canonicalUnitBinding(current);
  if (isLayoutShell(unit) || isRootish(unit) || isCollection(unit) || isStructuralSection(unit)) {
    return looksLikeUnit(hit) && !isLayoutShell(hit) && !isStructuralSection(hit)
      ? canonicalUnitBinding(hit)
      : null;
  }
  return unit;
}

function parentDiscovery(unit: HTMLElement): { binding: HTMLElement; role: VisualRole } | null {
  const parent = unit.parentElement;
  if (!(parent instanceof HTMLElement) || isRootish(parent) || isLayoutShell(parent)) {
    return null;
  }
  if (isCollection(parent)) {
    return { binding: parent, role: "collection" };
  }
  if (isStructuralSection(parent)) {
    return { binding: parent, role: "section" };
  }
  return null;
}

export function discoverFromPath(path: readonly Element[]): VisualDiscovery | null {
  const hits = path.filter((node): node is HTMLElement => node instanceof HTMLElement && !isSkippable(node));
  for (const hit of hits) {
    if (isLayoutShell(hit) || isRootish(hit)) {
      continue;
    }
    const unit = nearestUnit(hit);
    if (!unit || isLayoutShell(unit) || isRootish(unit) || isCollection(unit) || isStructuralSection(unit)) {
      continue;
    }
    const parent = parentDiscovery(unit);
    return {
      binding: unit,
      role: "unit",
      parentBinding: parent?.binding ?? null,
      parentRole: parent?.role ?? null,
    };
  }
  return null;
}

export function discoverFromElement(element: HTMLElement): VisualDiscovery | null {
  const path: Element[] = [];
  let current: Element | null = element;
  while (current) {
    path.push(current);
    current = current.parentElement;
  }
  return discoverFromPath(path);
}
