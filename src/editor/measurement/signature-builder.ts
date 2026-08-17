import type { BoundingBoxHint, ElementSignature } from "../element-signature.js";
import { isDangerousTagName } from "../validation/dangerous-selectors.js";
import type { MatchViewport } from "../dom/types.js";
import { getMatchViewport } from "../dom/match-viewport.js";
import {
  MAX_ANCESTOR_TEXT_CONTEXT_LENGTH,
  MAX_TEXT_FINGERPRINT_LENGTH,
} from "./constants.js";
import { fingerprintSrcValue } from "./src-fingerprint.js";
import { extractBoundingBox } from "./bounding-box.js";
import type { MeasurementRect } from "./types.js";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength).trim();
}

function escapeCssIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function getNthOfTypeSegment(element: Element): string | null {
  const parent = element.parentElement;
  if (!parent) {
    return null;
  }

  const siblings = Array.from(parent.children).filter(
    (child) => child.tagName === element.tagName,
  );

  if (siblings.length <= 1) {
    return null;
  }

  const index = siblings.indexOf(element) + 1;
  return `:nth-of-type(${String(index)})`;
}

function buildSegment(element: Element): string {
  const tagName = element.tagName.toLowerCase();
  let segment = tagName;

  if (element.id) {
    segment += `#${escapeCssIdentifier(element.id)}`;
    return segment;
  }

  if (element.classList.length > 0) {
    const classes = Array.from(element.classList)
      .slice(0, 3)
      .map((className) => `.${escapeCssIdentifier(className)}`)
      .join("");
    segment += classes;
    // When siblings share the same tag + leading classes, a class-only segment
    // is not a durable identity. Disambiguate with :nth-of-type.
    if (hasAmbiguousClassSibling(element)) {
      const nth = getNthOfTypeSegment(element);
      if (nth) {
        segment += nth;
      }
    }
    return segment;
  }

  const nth = getNthOfTypeSegment(element);
  if (nth) {
    segment += nth;
  }

  return segment;
}

function hasAmbiguousClassSibling(element: Element): boolean {
  const parent = element.parentElement;
  if (!parent) {
    return false;
  }

  const classes = Array.from(element.classList).slice(0, 3);
  let matches = 0;
  for (const child of Array.from(parent.children)) {
    if (child.tagName !== element.tagName) {
      continue;
    }
    const childClasses = Array.from(child.classList).slice(0, 3);
    if (
      childClasses.length === classes.length &&
      classes.every((className, index) => childClasses[index] === className)
    ) {
      matches += 1;
      if (matches > 1) {
        return true;
      }
    }
  }

  return false;
}

function getPathStopElement(root: ParentNode): Element | null {
  if ("documentElement" in root && root.documentElement instanceof Element) {
    return root.documentElement;
  }

  if (root instanceof Element) {
    return root;
  }

  return null;
}

export function buildCssPath(element: Element, root: ParentNode = element.ownerDocument): string {
  const stopElement = getPathStopElement(root);
  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current !== stopElement) {
    if (isDangerousTagName(current.tagName)) {
      break;
    }

    segments.unshift(buildSegment(current));
    current = current.parentElement;
  }

  return segments.join(" > ");
}

export function buildTextFingerprint(element: Element): string | undefined {
  const directText = truncateText(
    normalizeText(getDirectTextContent(element)),
    MAX_TEXT_FINGERPRINT_LENGTH,
  );
  if (directText) {
    return directText;
  }

  const text = truncateText(normalizeText(element.textContent), MAX_TEXT_FINGERPRINT_LENGTH);
  return text || undefined;
}

function getDirectTextContent(element: Element): string {
  let text = "";
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    }
  }
  return text;
}

export function buildSrcFingerprint(element: Element): string | undefined {
  if (!(element instanceof HTMLImageElement)) {
    const src = element.getAttribute("src")?.trim();
    if (!src) {
      return undefined;
    }
    return fingerprintSrcValue(src);
  }

  const src = element.currentSrc || element.src;
  return src ? fingerprintSrcValue(src) : undefined;
}

export function buildAncestorTextContext(element: Element): string | undefined {
  const snippets: string[] = [];
  const parent = element.parentElement;
  if (parent && !isDangerousTagName(parent.tagName)) {
    const parentText = truncateText(normalizeText(parent.textContent), 80);
    if (parentText) {
      snippets.push(parentText);
    }
  }

  const previous = element.previousElementSibling;
  if (previous) {
    const previousText = truncateText(normalizeText(previous.textContent), 40);
    if (previousText) {
      snippets.push(previousText);
    }
  }

  const next = element.nextElementSibling;
  if (next) {
    const nextText = truncateText(normalizeText(next.textContent), 40);
    if (nextText) {
      snippets.push(nextText);
    }
  }

  const combined = truncateText(normalizeText(snippets.join(" | ")), MAX_ANCESTOR_TEXT_CONTEXT_LENGTH);
  return combined || undefined;
}

/**
 * Builds a rich signature from a live element for persistence/replay. Prefer this
 * over graph-derived signatures when saving hide operations.
 */
export function buildPersistableElementSignature(
  element: Element,
  options: { root?: ParentNode; viewport?: MatchViewport } = {},
): ElementSignature {
  const signature = buildElementSignature(element, options);
  const titleAttr = element.getAttribute("title")?.trim();
  const altAttr = element.getAttribute("alt")?.trim();
  const srcFingerprint = buildSrcFingerprint(element);
  const ancestorTextContext = buildAncestorTextContext(element);
  const parent = element.parentElement;

  if (titleAttr) {
    signature.titleAttr = titleAttr;
  }
  if (altAttr) {
    signature.altAttr = altAttr;
  }
  if (srcFingerprint) {
    signature.srcFingerprint = srcFingerprint;
  }
  if (ancestorTextContext) {
    signature.ancestorTextContext = ancestorTextContext;
  }
  if (parent && !isDangerousTagName(parent.tagName)) {
    signature.parentCssPath = buildCssPath(parent, options.root ?? element.ownerDocument);
  }

  return signature;
}

export function buildParentFingerprint(element: Element): string | undefined {
  const parent = element.parentElement;
  if (!parent || isDangerousTagName(parent.tagName)) {
    return undefined;
  }

  const classes = Array.from(parent.classList).slice(0, 3).join(".");
  const idPart = parent.id ? `#${parent.id}` : "";
  const classPart = classes ? `.${classes}` : "";
  const fingerprint = `${parent.tagName.toLowerCase()}${idPart}${classPart}`.trim();

  return fingerprint || undefined;
}

export function buildBoundingBoxHint(
  rect: MeasurementRect,
  viewport: MatchViewport,
): BoundingBoxHint {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return {
      xRatio: 0,
      yRatio: 0,
      widthRatio: 0,
      heightRatio: 0,
    };
  }

  const clampRatio = (value: number): number => Math.min(1, Math.max(0, value));

  return {
    xRatio: clampRatio(rect.x / viewport.width),
    yRatio: clampRatio(rect.y / viewport.height),
    widthRatio: clampRatio(rect.width / viewport.width),
    heightRatio: clampRatio(rect.height / viewport.height),
  };
}

export function buildElementSignature(
  element: Element,
  options: { root?: ParentNode; viewport?: MatchViewport } = {},
): ElementSignature {
  const viewport = options.viewport ?? getMatchViewport(element.ownerDocument);
  const rect = extractBoundingBox(element);
  const classList = Array.from(element.classList);
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  const role = element.getAttribute("role")?.trim();
  const idAttr = element.id.trim() || undefined;

  const signature: ElementSignature = {
    cssPath: buildCssPath(element, options.root ?? element.ownerDocument),
    tagName: element.tagName.toLowerCase(),
    classList,
    boundingBoxHint: buildBoundingBoxHint(rect, viewport),
  };

  if (idAttr) {
    signature.idAttr = idAttr;
  }

  if (role) {
    signature.role = role;
  }

  if (ariaLabel) {
    signature.ariaLabel = ariaLabel;
  }

  const textFingerprint = buildTextFingerprint(element);
  if (textFingerprint) {
    signature.textFingerprint = textFingerprint;
  }

  const parentFingerprint = buildParentFingerprint(element);
  if (parentFingerprint) {
    signature.parentFingerprint = parentFingerprint;
  }

  return signature;
}
