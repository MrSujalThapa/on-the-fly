import type { ElementSignature } from "../element-signature.js";
import { isDangerousCssPath, isDangerousTagName } from "../validation/dangerous-selectors.js";
import type { MatchViewport } from "./types.js";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function tagMatches(element: Element, tagName: string): boolean {
  return element.tagName.toLowerCase() === tagName.trim().toLowerCase();
}

function classListMatches(element: Element, classList: string[]): boolean {
  return classList.every((className) => element.classList.contains(className));
}

function scoreBoundingBoxHint(
  element: Element,
  signature: ElementSignature,
  viewport: MatchViewport,
): number {
  const hint = signature.boundingBoxHint;

  if (hint.widthRatio === 0 && hint.heightRatio === 0 && hint.xRatio === 0 && hint.yRatio === 0) {
    return 0;
  }

  if (viewport.width <= 0 || viewport.height <= 0) {
    return 0;
  }

  const rect = element.getBoundingClientRect();
  const xRatio = rect.left / viewport.width;
  const yRatio = rect.top / viewport.height;
  const widthRatio = rect.width / viewport.width;
  const heightRatio = rect.height / viewport.height;

  return (
    Math.abs(xRatio - hint.xRatio) +
    Math.abs(yRatio - hint.yRatio) +
    Math.abs(widthRatio - hint.widthRatio) +
    Math.abs(heightRatio - hint.heightRatio)
  );
}

function filterCandidates(elements: Element[], signature: ElementSignature): Element[] {
  return elements.filter((element) => {
    if (!tagMatches(element, signature.tagName)) {
      return false;
    }

    if (isDangerousTagName(element.tagName)) {
      return false;
    }

    if (signature.idAttr && element.id !== signature.idAttr) {
      return false;
    }

    if (!classListMatches(element, signature.classList)) {
      return false;
    }

    if (signature.role && element.getAttribute("role") !== signature.role) {
      return false;
    }

    if (signature.ariaLabel && element.getAttribute("aria-label") !== signature.ariaLabel) {
      return false;
    }

    if (signature.textFingerprint) {
      const fingerprint = normalizeText(element.textContent);
      if (fingerprint !== normalizeText(signature.textFingerprint)) {
        return false;
      }
    }

    return true;
  });
}

function getQueryRoot(root: ParentNode): ParentNode {
  if (root instanceof Document) {
    return root.documentElement;
  }

  return root;
}

function safeQueryElements(root: ParentNode, cssPath: string): Element[] {
  if (isDangerousCssPath(cssPath)) {
    return [];
  }

  try {
    return Array.from(getQueryRoot(root).querySelectorAll(cssPath));
  } catch {
    return [];
  }
}

export function getMatchViewport(root: ParentNode): MatchViewport {
  if ("documentElement" in root) {
    const doc = root as Document;
    const width =
      doc.documentElement.clientWidth ||
      doc.documentElement.scrollWidth ||
      doc.defaultView?.innerWidth ||
      0;
    const height =
      doc.documentElement.clientHeight ||
      doc.documentElement.scrollHeight ||
      doc.defaultView?.innerHeight ||
      0;

    return { width, height };
  }

  if (root instanceof HTMLElement) {
    return {
      width: root.clientWidth,
      height: root.clientHeight,
    };
  }

  return { width: 0, height: 0 };
}

export function matchElementBySignature(
  root: ParentNode,
  signature: ElementSignature,
  viewport: MatchViewport = getMatchViewport(root),
): HTMLElement | null {
  if (isDangerousTagName(signature.tagName) || isDangerousCssPath(signature.cssPath)) {
    return null;
  }

  const candidates = filterCandidates(safeQueryElements(root, signature.cssPath), signature);
  if (candidates.length === 0) {
    return null;
  }

  let best: Element | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const score = scoreBoundingBoxHint(candidate, signature, viewport);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best instanceof HTMLElement ? best : null;
}
