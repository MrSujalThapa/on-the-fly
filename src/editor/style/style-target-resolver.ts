import { matchElementBySignature } from "../dom/signature-matcher.js";
import { buildPersistableElementSignature } from "../measurement/signature-builder.js";
import { isExtensionRoot } from "../measurement/scan-guards.js";
import type { StyleProperty } from "../operations.js";
import type { TransformTarget } from "../transform/transform-target.js";

export const MAX_TEXT_DESCENDANT_STYLE_TARGETS = 50;
export const MAX_SURFACE_PROMOTION_TEXT_LENGTH = 700;
export const MAX_SURFACE_PROMOTION_DESCENDANTS = 80;

export const CONTAINER_STYLE_PROPERTIES: ReadonlySet<StyleProperty> = new Set([
  "backgroundColor",
  "borderRadius",
  "opacity",
  "borderColor",
  "borderWidth",
  "boxShadow",
  "filter",
  "textAlign",
]);

export const TEXT_DESCENDANT_STYLE_PROPERTIES: ReadonlySet<StyleProperty> = new Set([
  "color",
  "fontSize",
  "fontWeight",
]);

export interface ResolvedStyleElementTarget {
  element: HTMLElement;
  signatureTarget: TransformTarget;
}

export interface StyleTargetResolution {
  targets: ResolvedStyleElementTarget[];
  capped: boolean;
  skippedHidden: number;
}

const SKIP_TAGS = new Set([
  "script",
  "style",
  "svg",
  "path",
  "noscript",
  "iframe",
  "canvas",
  "video",
  "audio",
]);

const INLINE_TEXT_TAGS = new Set([
  "a",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "small",
  "mark",
  "code",
]);

const BLOCK_SURFACE_TAGS = new Set([
  "article",
  "aside",
  "blockquote",
  "button",
  "div",
  "figure",
  "li",
  "main",
  "p",
  "section",
]);

export function isContainerStyleProperty(property: StyleProperty): boolean {
  return CONTAINER_STYLE_PROPERTIES.has(property);
}

export function isTextDescendantStyleProperty(property: StyleProperty): boolean {
  return TEXT_DESCENDANT_STYLE_PROPERTIES.has(property);
}

export function resolveStyleElementTargets(
  property: StyleProperty,
  transformTargets: TransformTarget[],
  document: Document,
): StyleTargetResolution {
  if (isTextDescendantStyleProperty(property)) {
    return resolveTextDescendantTargets(transformTargets, document);
  }

  const targets: ResolvedStyleElementTarget[] = [];
  const seen = new Set<HTMLElement>();
  for (const target of transformTargets) {
    const element = resolveLiveElement(target, document);
    if (!element) {
      continue;
    }
    const styleElement = resolveContainerStyleSurface(element, property);
    pushUniqueTarget(targets, seen, styleElement, target);
  }

  return { targets, capped: false, skippedHidden: 0 };
}

function resolveTextDescendantTargets(
  transformTargets: TransformTarget[],
  document: Document,
): StyleTargetResolution {
  const seen = new Set<HTMLElement>();
  const targets: ResolvedStyleElementTarget[] = [];
  let capped = false;
  let skippedHidden = 0;

  for (const target of transformTargets) {
    const root = resolveLiveElement(target, document);
    if (!root) {
      continue;
    }

    if (isSafeDirectTextElement(root)) {
      pushUniqueTarget(targets, seen, root, target);
      continue;
    }

    const descendants = collectSafeTextDescendants(root);
    for (const element of descendants) {
      if (targets.length >= MAX_TEXT_DESCENDANT_STYLE_TARGETS) {
        capped = true;
        break;
      }
      if (!isVisibleTextElement(element)) {
        skippedHidden += 1;
        continue;
      }
      pushUniqueTarget(targets, seen, element, target);
    }

    if (capped) {
      break;
    }
  }

  return { targets, capped, skippedHidden };
}

function pushUniqueTarget(
  targets: ResolvedStyleElementTarget[],
  seen: Set<HTMLElement>,
  element: HTMLElement,
  fallbackTarget: TransformTarget,
): void {
  if (seen.has(element)) {
    return;
  }
  seen.add(element);
  targets.push({
    element,
    signatureTarget: toElementStyleTarget(element, fallbackTarget),
  });
}

function toElementStyleTarget(element: HTMLElement, fallback: TransformTarget): TransformTarget {
  const rect = element.getBoundingClientRect();
  return {
    nodeId: fallback.nodeId,
    signature: buildPersistableElementSignature(element),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    element,
  };
}

function resolveContainerStyleSurface(
  element: HTMLElement,
  property: StyleProperty,
): HTMLElement {
  if (!shouldPromoteContainerStyle(property, element)) {
    return element;
  }

  const promoted = findNearestVisibleSurface(element);
  return promoted ?? element;
}

function shouldPromoteContainerStyle(property: StyleProperty, element: HTMLElement): boolean {
  if (!isContainerStyleProperty(property)) {
    return false;
  }

  const tag = element.tagName.toLowerCase();
  if (INLINE_TEXT_TAGS.has(tag)) {
    return true;
  }

  if (hasSurfaceClues(element)) {
    return false;
  }

  const parent = element.parentElement;
  if (!parent || isBlockedSurfaceAncestor(parent)) {
    return false;
  }

  if (element.children.length === 0 && hasMeaningfulText(element)) {
    return hasSurfaceClues(parent);
  }

  return false;
}

function findNearestVisibleSurface(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current && !isBlockedSurfaceAncestor(current)) {
    if (isSafeSurfaceCandidate(current, element)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function isSafeSurfaceCandidate(candidate: HTMLElement, original: HTMLElement): boolean {
  if (candidate === original || isBlockedTextEditElement(candidate)) {
    return false;
  }

  const text = candidate.textContent.replace(/\s+/g, " ").trim();
  if (text.length > MAX_SURFACE_PROMOTION_TEXT_LENGTH) {
    return false;
  }

  if (candidate.querySelectorAll("*").length > MAX_SURFACE_PROMOTION_DESCENDANTS) {
    return false;
  }

  return hasSurfaceClues(candidate);
}

function isBlockedSurfaceAncestor(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === "html" || tag === "body" || isExtensionRoot(element);
}

function hasSurfaceClues(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (BLOCK_SURFACE_TAGS.has(tag)) {
    return true;
  }

  const role = element.getAttribute("role");
  if (role === "button" || role === "article" || role === "listitem") {
    return true;
  }

  const name = `${element.id} ${Array.from(element.classList).join(" ")}`.toLowerCase();
  if (/\b(card|container|panel|tile|item|notification|message|profile|surface|box)\b/.test(name)) {
    return true;
  }

  const view = element.ownerDocument.defaultView;
  if (!view) {
    return false;
  }
  const style = view.getComputedStyle(element);
  if (style.display === "inline" || style.display === "contents") {
    return false;
  }

  return (
    hasVisiblePaint(style.backgroundColor) ||
    hasVisiblePaint(style.borderColor) ||
    style.borderRadius !== "0px" ||
    style.boxShadow !== "none" ||
    Number.parseFloat(style.paddingTop) > 0 ||
    Number.parseFloat(style.paddingLeft) > 0
  );
}

function hasVisiblePaint(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized && normalized !== "transparent" && normalized !== "rgba(0, 0, 0, 0)");
}

function resolveLiveElement(target: TransformTarget, document: Document): HTMLElement | null {
  if (target.element?.isConnected) {
    return target.element;
  }
  return matchElementBySignature(document, target.signature);
}

function isSafeDirectTextElement(element: HTMLElement): boolean {
  if (element.children.length > 0) {
    return false;
  }
  return hasMeaningfulText(element);
}

function collectSafeTextDescendants(root: HTMLElement): HTMLElement[] {
  const results: HTMLElement[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node instanceof HTMLElement && isSafeDirectTextElement(node)) {
      results.push(node);
    }
    node = walker.nextNode();
  }
  return results;
}

function isVisibleTextElement(element: HTMLElement): boolean {
  if (!hasMeaningfulText(element)) {
    return false;
  }
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return true;
  }
  const style = view.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return true;
  }
  // jsdom and other non-layout environments report 0x0 rects for visible text.
  return style.display !== "none" && style.visibility !== "hidden";
}

function hasMeaningfulText(element: HTMLElement): boolean {
  return element.textContent.trim().length > 0;
}

export function isBlockedTextEditElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag) || isExtensionRoot(element)) {
    return true;
  }
  return false;
}
