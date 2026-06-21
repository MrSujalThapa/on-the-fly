import type { MatchViewport } from "../dom/types.js";
import {
  extractBoundingBox,
  isZeroSizeRect,
  rectToVisualNodeRect,
} from "../measurement/bounding-box.js";
import { GIANT_NODE_AREA_RATIO } from "../measurement/constants.js";
import { snapshotComputedStyles } from "../measurement/computed-styles.js";
import { detectElementKind, isLikelyContainer } from "../measurement/element-kind.js";
import { overlapArea, rectArea } from "../measurement/geometry.js";
import { isExtensionRoot, isGiantPageWrapper } from "../measurement/scan-guards.js";
import { buildElementSignature } from "../measurement/signature-builder.js";
import type { MeasurementRect } from "../measurement/types.js";
import type { VisualNode } from "../visual-node.js";
import {
  buildRectangleSampleGrid,
  isSelectableLassoSampleElement,
} from "./rectangle-sampling.js";
import { logSelectionDebug } from "./selection-debug.js";

/**
 * DOM-first rectangle selection. The drawn rectangle is resolved purely from
 * `document.elementsFromPoint` stacks and DOM ancestry, mirroring the Genie
 * prototype. The VisualGraph is never required here; callers may enrich the
 * resulting DOM targets with graph metadata separately.
 */

export const MAX_CONTAINER_VIEWPORT_RATIO = 0.85;
export const MAX_CONTAINER_TO_RECT_RATIO = 9;
export const MIN_RECT_OVERLAP_SELF = 0.08;
export const MIN_RECT_OVERLAP_RECT = 0.04;
export const ANCESTOR_WALK_LIMIT = 8;
export const WHOLE_PAGE_UNION_RATIO = 0.9;
export const SECONDARY_SCORE_RATIO = 0.45;
export const MAX_SELECTED_CONTAINERS = 24;

const USEFUL_CONTAINER_TAGS = new Set([
  "article",
  "section",
  "aside",
  "li",
  "figure",
  "blockquote",
  "details",
  "fieldset",
  "tr",
  "td",
  "th",
  "nav",
]);

const INTERACTIVE_TAGS = new Set(["a", "button"]);

const USEFUL_ROLES = new Set([
  "listitem",
  "article",
  "row",
  "gridcell",
  "menuitem",
  "option",
  "treeitem",
  "tab",
  "button",
  "link",
  "group",
  "region",
  "note",
  "complementary",
]);

const STRONG_ROLES = new Set([
  "listitem",
  "article",
  "row",
  "gridcell",
  "menuitem",
  "option",
  "treeitem",
  "tab",
]);

const STRONG_CONTAINER_TAGS = new Set([
  "li",
  "article",
  "section",
  "aside",
  "figure",
  "tr",
  "td",
]);

const CLASS_ID_HINT =
  /(?:^|[-_ ])(card|item|row|notification|notif|feed|result|profile|message|sidebar|widget|cell|tile|post|entry|comment|story|listitem|list-item|article)(?:[-_ ]|$)/i;

export interface DomRectangleStats {
  rectangle: MeasurementRect;
  samplePointCount: number;
  collectedElementCount: number;
  candidateCount: number;
  selected: { tag: string; classes: string[] }[];
  rejectionReason?: string;
}

export interface DomRectangleResult {
  elements: Element[];
  unionRect: MeasurementRect | null;
  stats: DomRectangleStats;
}

function getElementRole(element: Element): string | null {
  const role = element.getAttribute("role");
  return role ? role.trim().toLowerCase() : null;
}

function classIdHintText(element: Element): string {
  const classes = Array.from(element.classList).join(" ");
  return `${element.id} ${classes}`;
}

function hasClassOrIdHint(element: Element): boolean {
  return CLASS_ID_HINT.test(classIdHintText(element));
}

export function isUsefulContainer(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (USEFUL_CONTAINER_TAGS.has(tag) || INTERACTIVE_TAGS.has(tag)) {
    return true;
  }

  const role = getElementRole(element);
  if (role && USEFUL_ROLES.has(role)) {
    return true;
  }

  return hasClassOrIdHint(element);
}

export function containerUsefulnessScore(element: Element): number {
  let score = 0;
  const tag = element.tagName.toLowerCase();
  const role = getElementRole(element);

  if (role && STRONG_ROLES.has(role)) {
    score += 30;
  } else if (role && USEFUL_ROLES.has(role)) {
    score += 18;
  }

  if (STRONG_CONTAINER_TAGS.has(tag)) {
    score += 24;
  } else if (USEFUL_CONTAINER_TAGS.has(tag)) {
    score += 12;
  } else if (INTERACTIVE_TAGS.has(tag)) {
    score += 18;
  }

  if (hasClassOrIdHint(element)) {
    score += 20;
  }

  return score;
}

export function collectRectangleSampleElements(
  document: Document,
  rect: MeasurementRect,
  viewport: MatchViewport,
): { elements: Element[]; samplePointCount: number } {
  const points = buildRectangleSampleGrid(rect);
  const seen = new Set<Element>();
  const elements: Element[] = [];

  for (const point of points) {
    const stack = document.elementsFromPoint(point.x, point.y);
    for (const target of stack) {
      if (!(target instanceof Element)) {
        continue;
      }

      if (!isSelectableLassoSampleElement(target, viewport)) {
        continue;
      }

      if (!seen.has(target)) {
        seen.add(target);
        elements.push(target);
      }

      // Only the topmost meaningful element at each sample point is a leaf;
      // useful containers are recovered via DOM ancestry.
      break;
    }
  }

  return { elements, samplePointCount: points.length };
}

function collectCandidateAncestors(
  leaf: Element,
  viewport: MatchViewport,
): Element[] {
  const candidates: Element[] = [];
  let current: Element | null = leaf;
  let steps = 0;

  while (current && steps < ANCESTOR_WALK_LIMIT) {
    const tag = current.tagName.toLowerCase();
    if (tag === "body" || tag === "html") {
      break;
    }

    if (isExtensionRoot(current)) {
      break;
    }

    if (isGiantPageWrapper(current, viewport)) {
      break;
    }

    if (current === leaf || isUsefulContainer(current)) {
      candidates.push(current);
    }

    current = current.parentElement;
    steps += 1;
  }

  return candidates;
}

function countContainedSamples(container: Element, sampledLeaves: Element[]): number {
  let count = 0;
  for (const leaf of sampledLeaves) {
    if (container === leaf || container.contains(leaf)) {
      count += 1;
    }
  }
  return count;
}

export function scoreRectangleCandidate(
  element: Element,
  rect: MeasurementRect,
  sampledLeaves: Element[],
  viewport: MatchViewport,
): number | null {
  const elementRect = extractBoundingBox(element);
  if (isZeroSizeRect(elementRect)) {
    return null;
  }

  const elementArea = rectArea(elementRect);
  const viewportArea = Math.max(1, viewport.width * viewport.height);
  const viewportRatio = elementArea / viewportArea;

  if (viewportRatio >= GIANT_NODE_AREA_RATIO || viewportRatio >= MAX_CONTAINER_VIEWPORT_RATIO) {
    return null;
  }

  const intersection = overlapArea(elementRect, rect);
  if (intersection <= 0) {
    return null;
  }

  const overlapSelf = intersection / elementArea;
  const rectAreaValue = Math.max(1, rectArea(rect));
  const overlapRect = intersection / rectAreaValue;

  if (overlapSelf < MIN_RECT_OVERLAP_SELF && overlapRect < MIN_RECT_OVERLAP_RECT) {
    return null;
  }

  if (elementArea > rectAreaValue * MAX_CONTAINER_TO_RECT_RATIO && overlapSelf < 0.55) {
    return null;
  }

  const containedSamples = countContainedSamples(element, sampledLeaves);

  let score = 0;
  score += containedSamples * 12;
  score += overlapSelf * 28;
  score += overlapRect * 16;
  score += containerUsefulnessScore(element);

  const sizeRatio = elementArea / rectAreaValue;
  if (sizeRatio > 4) {
    score -= Math.min(20, (sizeRatio - 4) * 3);
  }

  return score;
}

interface ScoredCandidate {
  element: Element;
  score: number;
}

function buildScoredCandidates(
  sampledLeaves: Element[],
  rect: MeasurementRect,
  viewport: MatchViewport,
): ScoredCandidate[] {
  const bestByElement = new Map<Element, number>();

  for (const leaf of sampledLeaves) {
    for (const candidate of collectCandidateAncestors(leaf, viewport)) {
      const score = scoreRectangleCandidate(candidate, rect, sampledLeaves, viewport);
      if (score === null) {
        continue;
      }

      const previous = bestByElement.get(candidate);
      if (previous === undefined || score > previous) {
        bestByElement.set(candidate, score);
      }
    }
  }

  return Array.from(bestByElement.entries())
    .map(([element, score]) => ({ element, score }))
    .sort((left, right) => right.score - left.score);
}

function selectBestContainers(
  candidates: ScoredCandidate[],
  sampledLeaves: Element[],
): Element[] {
  if (candidates.length === 0) {
    return [];
  }

  const best = candidates[0];
  if (!best) {
    return [];
  }

  const selected: Element[] = [];
  const coveredLeaves = new Set<Element>();
  const scoreFloor = best.score * SECONDARY_SCORE_RATIO;

  for (const candidate of candidates) {
    if (selected.length >= MAX_SELECTED_CONTAINERS) {
      break;
    }

    if (selected.length > 0 && candidate.score < scoreFloor) {
      continue;
    }

    if (
      selected.some(
        (chosen) => chosen.contains(candidate.element) || candidate.element.contains(chosen),
      )
    ) {
      continue;
    }

    const covered = sampledLeaves.filter(
      (leaf) => candidate.element === leaf || candidate.element.contains(leaf),
    );
    const newlyCovered = covered.filter((leaf) => !coveredLeaves.has(leaf));
    if (selected.length > 0 && newlyCovered.length === 0) {
      continue;
    }

    selected.push(candidate.element);
    for (const leaf of covered) {
      coveredLeaves.add(leaf);
    }
  }

  return selected;
}

function dedupeNestedElements(elements: Element[]): Element[] {
  return elements.filter(
    (element, index) =>
      !elements.some(
        (other, otherIndex) => otherIndex !== index && other.contains(element) && other !== element,
      ),
  );
}

function unionOfRects(rects: MeasurementRect[]): MeasurementRect | null {
  if (rects.length === 0) {
    return null;
  }

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function isWholePageUnion(union: MeasurementRect | null, viewport: MatchViewport): boolean {
  if (!union) {
    return false;
  }

  const viewportArea = Math.max(1, viewport.width * viewport.height);
  return rectArea(union) / viewportArea >= WHOLE_PAGE_UNION_RATIO;
}

export function resolveRectangleDomElements(
  document: Document,
  rect: MeasurementRect,
  viewport: MatchViewport,
): DomRectangleResult {
  const { elements: sampledLeaves, samplePointCount } = collectRectangleSampleElements(
    document,
    rect,
    viewport,
  );

  const makeStats = (
    candidateCount: number,
    selected: Element[],
    rejectionReason?: string,
  ): DomRectangleStats => ({
    rectangle: rect,
    samplePointCount,
    collectedElementCount: sampledLeaves.length,
    candidateCount,
    selected: selected.map((element) => ({
      tag: element.tagName.toLowerCase(),
      classes: Array.from(element.classList),
    })),
    ...(rejectionReason ? { rejectionReason } : {}),
  });

  if (sampledLeaves.length === 0) {
    const stats = makeStats(0, [], "no-elements");
    logSelectionDebug("rectangle-dom", stats);
    return { elements: [], unionRect: null, stats };
  }

  const candidates = buildScoredCandidates(sampledLeaves, rect, viewport);
  let chosen = selectBestContainers(candidates, sampledLeaves);

  if (chosen.length === 0) {
    // No useful container scored: fall back to the direct sampled leaves.
    chosen = dedupeNestedElements(sampledLeaves);
  }

  if (chosen.length === 0) {
    const stats = makeStats(candidates.length, [], "no-candidates");
    logSelectionDebug("rectangle-dom", stats);
    return { elements: [], unionRect: null, stats };
  }

  const unionRect = unionOfRects(chosen.map((element) => extractBoundingBox(element)));

  if (isWholePageUnion(unionRect, viewport)) {
    const stats = makeStats(candidates.length, [], "whole-page");
    logSelectionDebug("rectangle-dom", stats);
    return { elements: [], unionRect: null, stats };
  }

  const stats = makeStats(candidates.length, chosen);
  logSelectionDebug("rectangle-dom", stats);
  return { elements: chosen, unionRect, stats };
}

export function buildDomSelectionTarget(
  element: Element,
  id: string,
  viewport: MatchViewport,
): VisualNode {
  const rect = extractBoundingBox(element);
  const kind = detectElementKind(element);

  return {
    id,
    kind,
    signature: buildElementSignature(element, { viewport }),
    rect: rectToVisualNodeRect(rect),
    computed: snapshotComputedStyles(element),
    childIds: [],
    isLikelyContainer: isLikelyContainer(element, kind),
    isPageLevel: isGiantPageWrapper(element, viewport),
  };
}
