import { matchElementBySignature } from "../dom/signature-matcher.js";
import { buildPersistableElementSignature } from "../measurement/signature-builder.js";
import { isExtensionRoot } from "../measurement/scan-guards.js";
import type { StyleProperty } from "../operations.js";
import type { TransformTarget } from "../transform/transform-target.js";

export const MAX_TEXT_DESCENDANT_STYLE_TARGETS = 50;

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
  for (const target of transformTargets) {
    const element = resolveLiveElement(target, document);
    if (!element) {
      continue;
    }
    targets.push({ element, signatureTarget: target });
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
