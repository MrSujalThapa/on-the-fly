import type { ElementSignature } from "../element-signature.js";
import { fingerprintSrcValue } from "../measurement/src-fingerprint.js";
import { getMatchViewport } from "./match-viewport.js";
import { isDangerousCssPath, isDangerousTagName } from "../validation/dangerous-selectors.js";
import type { MatchViewport } from "./types.js";
import { OTF_DETACH_ATTR } from "./managed-detach.js";
import { OTF_MANAGED_ATTR } from "./types.js";

export interface SignatureMatchDiagnostics {
  resolved: boolean;
  matchStrategy:
    | "live-session"
    | "cssPath-unique"
    | "cssPath-scored"
    | "fallback-scored"
    | "unresolved";
  score?: number;
  failureReason?: string;
  candidateCount?: number;
  resolvedTag?: string;
  resolvedClasses?: string[];
}

export interface SignatureMatchResult {
  element: HTMLElement | null;
  diagnostics: SignatureMatchDiagnostics;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeComparable(value: string | undefined): string {
  return value ? normalizeText(value).toLowerCase() : "";
}

function tagMatches(element: Element, tagName: string): boolean {
  return element.tagName.toLowerCase() === tagName.trim().toLowerCase();
}

function escapeCssIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
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

function classOverlapScore(element: Element, classList: string[]): number {
  if (classList.length === 0) {
    return 0;
  }

  const matched = classList.filter((className) => element.classList.contains(className)).length;
  const missing = classList.length - matched;
  return missing * 4 - matched * 2;
}

function scoreCandidate(
  element: Element,
  signature: ElementSignature,
  viewport: MatchViewport,
): number {
  let score = scoreBoundingBoxHint(element, signature, viewport);
  score += classOverlapScore(element, signature.classList);

  if (signature.idAttr) {
    score += element.id === signature.idAttr ? -8 : 40;
  }

  if (signature.role) {
    score += element.getAttribute("role") === signature.role ? -2 : 6;
  }

  if (signature.ariaLabel) {
    score += normalizeComparable(element.getAttribute("aria-label") ?? undefined) ===
      normalizeComparable(signature.ariaLabel)
      ? -3
      : 8;
  }

  if (signature.titleAttr) {
    score += normalizeComparable(element.getAttribute("title") ?? undefined) ===
      normalizeComparable(signature.titleAttr)
      ? -2
      : 6;
  }

  if (signature.altAttr) {
    score += normalizeComparable(element.getAttribute("alt") ?? undefined) ===
      normalizeComparable(signature.altAttr)
      ? -6
      : 12;
  }

  if (signature.textFingerprint) {
    const candidateText = normalizeComparable(element.textContent || "");
    const expected = normalizeComparable(signature.textFingerprint);
    score += candidateText === expected ? -4 : candidateText.includes(expected) ? 2 : 10;
  }

  if (signature.srcFingerprint) {
    const rawSrc =
      element instanceof HTMLImageElement
        ? element.currentSrc || element.src
        : element.getAttribute("src") || "";
    const candidateSrc = normalizeComparable(fingerprintSrcValue(rawSrc));
    const expected = normalizeComparable(signature.srcFingerprint);
    score += candidateSrc === expected || candidateSrc.includes(expected) || expected.includes(candidateSrc)
      ? -8
      : 14;
  }

  if (signature.parentFingerprint) {
    const parent = element.parentElement;
    const parentText = parent
      ? `${parent.tagName.toLowerCase()}${parent.id ? `#${parent.id}` : ""}`
      : "";
    score += parentText.includes(signature.parentFingerprint.split(".")[0] ?? "")
      ? -2
      : 4;
  }

  if (signature.parentCssPath && element.parentElement) {
    score += 2;
  }

  if (signature.ancestorTextContext) {
    const context = normalizeComparable(signature.ancestorTextContext);
    const parentText = normalizeComparable(element.parentElement?.textContent ?? undefined);
    score += parentText.includes(context) || context.includes(parentText.slice(0, 40)) ? -5 : 8;
  }

  // Managed / detached nodes leave their original cssPath. Prefer them when
  // fingerprints still match so re-resolution does not snap to an in-flow sibling.
  if (
    element instanceof HTMLElement &&
    (element.hasAttribute(OTF_MANAGED_ATTR) || element.getAttribute(OTF_DETACH_ATTR) === "true")
  ) {
    score -= 6;
  }

  return score;
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

function filterByTag(elements: Element[], signature: ElementSignature): Element[] {
  return elements.filter(
    (element) => tagMatches(element, signature.tagName) && !isDangerousTagName(element.tagName),
  );
}

function gatherFallbackCandidates(root: ParentNode, signature: ElementSignature): Element[] {
  const candidates = new Set<Element>();

  if (signature.idAttr) {
    try {
      const byId = getQueryRoot(root).querySelector(`#${escapeCssIdentifier(signature.idAttr)}`);
      if (byId instanceof Element && tagMatches(byId, signature.tagName)) {
        candidates.add(byId);
      }
    } catch {
      // Ignore invalid id selectors.
    }
  }

  let broadSelector = signature.tagName;
  if (signature.classList.length > 0) {
    broadSelector += signature.classList
      .slice(0, 3)
      .map((className) => `.${escapeCssIdentifier(className)}`)
      .join("");
  }

  if (signature.parentCssPath) {
    for (const parent of safeQueryElements(root, signature.parentCssPath)) {
      try {
        for (const match of Array.from(parent.querySelectorAll(broadSelector))) {
          candidates.add(match);
        }
      } catch {
        // Ignore invalid fallback selectors.
      }
    }
  }

  try {
    for (const match of Array.from(getQueryRoot(root).querySelectorAll(broadSelector))) {
      candidates.add(match);
    }
  } catch {
    // Ignore invalid fallback selectors.
  }

  if (signature.altAttr) {
    try {
      for (const match of Array.from(
        getQueryRoot(root).querySelectorAll(
          `${signature.tagName}[alt="${signature.altAttr.replace(/"/g, '\\"')}"]`,
        ),
      )) {
        candidates.add(match);
      }
    } catch {
      // Ignore invalid alt selectors.
    }
  }

  return [...candidates];
}

function pickBestCandidate(
  candidates: Element[],
  signature: ElementSignature,
  viewport: MatchViewport,
): { element: HTMLElement | null; score: number; ambiguous: boolean; candidateCount: number } {
  let best: Element | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let secondScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, signature, viewport);
    if (score < bestScore) {
      secondScore = bestScore;
      best = candidate;
      bestScore = score;
    } else if (score < secondScore) {
      secondScore = score;
    }
  }

  const maxAcceptableScore = signature.tagName === "img" ? 28 : 22;
  if (!best || bestScore > maxAcceptableScore) {
    return {
      element: null,
      score: bestScore,
      ambiguous: false,
      candidateCount: candidates.length,
    };
  }

  // Near-tied top scores are not a trustworthy identity. Callers must not
  // silently persist or replay against an arbitrary sibling.
  const ambiguous =
    candidates.length > 1 &&
    Number.isFinite(secondScore) &&
    secondScore - bestScore <= 1.5;

  return {
    element: ambiguous ? null : best instanceof HTMLElement ? best : null,
    score: bestScore,
    ambiguous,
    candidateCount: candidates.length,
  };
}

function unresolved(reason: string, candidateCount = 0): SignatureMatchResult {
  return {
    element: null,
    diagnostics: {
      resolved: false,
      matchStrategy: "unresolved",
      failureReason: reason,
      candidateCount,
    },
  };
}

export function matchElementBySignatureDetailed(
  root: ParentNode,
  signature: ElementSignature,
  viewport: MatchViewport = getMatchViewport(root),
): SignatureMatchResult {
  if (isDangerousTagName(signature.tagName) || isDangerousCssPath(signature.cssPath)) {
    return unresolved("dangerous_signature");
  }

  const cssPathCandidates = filterByTag(safeQueryElements(root, signature.cssPath), signature);
  if (cssPathCandidates.length === 1) {
    const element = cssPathCandidates[0];
    if (element instanceof HTMLElement) {
      return {
        element,
        diagnostics: {
          resolved: true,
          matchStrategy: "cssPath-unique",
          score: scoreCandidate(element, signature, viewport),
          candidateCount: 1,
          resolvedTag: element.tagName.toLowerCase(),
          resolvedClasses: Array.from(element.classList),
        },
      };
    }
  }

  if (cssPathCandidates.length > 1) {
    const picked = pickBestCandidate(cssPathCandidates, signature, viewport);
    if (picked.ambiguous) {
      return unresolved("ambiguous_candidates", picked.candidateCount);
    }
    if (picked.element) {
      return {
        element: picked.element,
        diagnostics: {
          resolved: true,
          matchStrategy: "cssPath-scored",
          score: picked.score,
          candidateCount: cssPathCandidates.length,
          resolvedTag: picked.element.tagName.toLowerCase(),
          resolvedClasses: Array.from(picked.element.classList),
        },
      };
    }
  }

  const fallbackCandidates = gatherFallbackCandidates(root, signature);
  const picked = pickBestCandidate(fallbackCandidates, signature, viewport);
  if (picked.ambiguous) {
    return unresolved("ambiguous_candidates", picked.candidateCount);
  }
  if (picked.element) {
    return {
      element: picked.element,
      diagnostics: {
        resolved: true,
        matchStrategy: "fallback-scored",
        score: picked.score,
        candidateCount: fallbackCandidates.length,
        resolvedTag: picked.element.tagName.toLowerCase(),
        resolvedClasses: Array.from(picked.element.classList),
      },
    };
  }

  if (cssPathCandidates.length > 0) {
    return unresolved("cssPath_candidates_scored_too_poorly", cssPathCandidates.length);
  }

  return unresolved("no_matching_candidates", fallbackCandidates.length);
}

export { getMatchViewport } from "./match-viewport.js";

export function matchElementBySignature(
  root: ParentNode,
  signature: ElementSignature,
  viewport: MatchViewport = getMatchViewport(root),
): HTMLElement | null {
  return matchElementBySignatureDetailed(root, signature, viewport).element;
}

export function summarizeElementSignature(signature: ElementSignature | undefined): string {
  if (!signature) {
    return "no-signature";
  }

  const parts = [signature.tagName];
  if (signature.idAttr) {
    parts.push(`#${signature.idAttr}`);
  }
  if (signature.classList.length > 0) {
    parts.push(`.${signature.classList.slice(0, 2).join(".")}`);
  }
  if (signature.altAttr) {
    parts.push(`alt:${signature.altAttr.slice(0, 24)}`);
  }
  if (signature.srcFingerprint) {
    parts.push(`src:${signature.srcFingerprint.slice(0, 24)}`);
  }
  if (signature.textFingerprint) {
    parts.push(`text:${signature.textFingerprint.slice(0, 24)}`);
  }

  return parts.join("");
}
