import { isExtensionRoot } from "../measurement/scan-guards.js";
import type { StyleProperty } from "../operations.js";

export const FILL_STYLE_PROPERTIES: ReadonlySet<StyleProperty> = new Set([
  "backgroundColor",
  "backgroundImage",
  "borderColor",
  "borderWidth",
  "borderRadius",
  "boxShadow",
]);

const SKIP_FILL_TAGS = new Set(["script", "style", "svg", "path", "noscript", "iframe", "canvas", "video", "audio", "img"]);
const MIN_COVERAGE = 0.72;

export function isFillStyleProperty(property: StyleProperty): boolean {
  return FILL_STYLE_PROPERTIES.has(property);
}

export function resolveStyleRealizationTarget(element: HTMLElement, property: StyleProperty): HTMLElement {
  return isFillStyleProperty(property) ? resolveFillSurface(element) : element;
}

/**
 * Background-like properties target the element that paints the selected object's surface.
 * Default is the selected element; a near-direct descendant is used only with strong evidence.
 */
export function resolveFillSurface(selected: HTMLElement): HTMLElement {
  if (hasOwnFillPaint(selected) || isBlockedFillNode(selected)) {
    return selected;
  }

  const selectedRect = selected.getBoundingClientRect();
  if (selectedRect.width < 2 || selectedRect.height < 2) {
    return selected;
  }

  const direct = plausibleFillChildren(selected, selectedRect);
  if (direct.length === 1) {
    return direct[0] ?? selected;
  }
  if (direct.length > 1) {
    return selected;
  }

  const wrappers = Array.from(selected.children).filter((child): child is HTMLElement =>
    child instanceof HTMLElement && isTransparentLayoutWrapper(child));
  if (wrappers.length !== 1 || !wrappers[0]) {
    return selected;
  }

  const nested = plausibleFillChildren(wrappers[0], selectedRect);
  return nested.length === 1 ? nested[0] ?? selected : selected;
}

export function setManagedStyleProperty(element: HTMLElement, cssProperty: string, value: string): void {
  element.style.setProperty(cssProperty, value);
  const afterNormal = getComputedStyle(element).getPropertyValue(cssProperty).trim();
  element.style.setProperty(cssProperty, value, "important");
  const afterImportant = getComputedStyle(element).getPropertyValue(cssProperty).trim();
  if (computedValuesMatch(afterNormal, afterImportant)) {
    element.style.setProperty(cssProperty, value);
  }
}

function plausibleFillChildren(parent: HTMLElement, selectedRect: DOMRect): HTMLElement[] {
  const matches: HTMLElement[] = [];
  for (const child of Array.from(parent.children)) {
    if (!(child instanceof HTMLElement) || !isPlausibleFillSurface(child, selectedRect)) {
      continue;
    }
    matches.push(child);
  }
  return matches;
}

function isPlausibleFillSurface(candidate: HTMLElement, selectedRect: DOMRect): boolean {
  if (isBlockedFillNode(candidate) || SKIP_FILL_TAGS.has(candidate.tagName.toLowerCase())) {
    return false;
  }
  const style = getComputedStyle(candidate);
  if (isHiddenStyle(style) || (!hasOwnFillPaint(candidate) && !hasSurfaceChrome(style))) {
    return false;
  }
  const rect = candidate.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) {
    return false;
  }
  return coverage(rect, selectedRect) >= MIN_COVERAGE;
}

function hasOwnFillPaint(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const color = style.backgroundColor.trim().toLowerCase();
  const paintedColor = Boolean(color) && color !== "transparent" && color !== "rgba(0, 0, 0, 0)";
  const image = style.backgroundImage.trim();
  return paintedColor || Boolean(image) && image !== "none";
}

function hasSurfaceChrome(style: CSSStyleDeclaration): boolean {
  const radius = style.borderRadius.trim();
  const shadow = style.boxShadow.trim();
  const border = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
    .some((width) => Number.parseFloat(width) > 0);
  return (Boolean(radius) && radius !== "0px" && radius !== "0%") ||
    (Boolean(shadow) && shadow !== "none") ||
    border;
}

function isTransparentLayoutWrapper(element: HTMLElement): boolean {
  return element.childElementCount > 0 && !hasOwnFillPaint(element) && !isBlockedFillNode(element);
}

function isBlockedFillNode(element: HTMLElement): boolean {
  return isExtensionRoot(element) || element.closest("[data-otf-ui]") !== null;
}

function isHiddenStyle(style: CSSStyleDeclaration): boolean {
  return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
}

function coverage(inner: DOMRect, outer: DOMRect): number {
  const width = Math.max(0, Math.min(inner.right, outer.right) - Math.max(inner.left, outer.left));
  const height = Math.max(0, Math.min(inner.bottom, outer.bottom) - Math.max(inner.top, outer.top));
  const outerArea = outer.width * outer.height;
  return outerArea <= 0 ? 0 : (width * height) / outerArea;
}

function computedValuesMatch(left: string, right: string): boolean {
  return left.replace(/\s+/g, "") === right.replace(/\s+/g, "");
}
