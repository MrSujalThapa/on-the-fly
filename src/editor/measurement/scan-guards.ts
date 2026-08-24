import { isDangerousTagName } from "../validation/dangerous-selectors.js";
import type { MatchViewport } from "../dom/types.js";
import { getMatchViewport } from "../dom/signature-matcher.js";
import {
  EXCLUDED_TAG_NAMES,
  GIANT_NODE_AREA_RATIO,
  OTF_ROOT_HOST_ATTR,
  OTF_ROOT_HOST_ID,
  OTF_ROOT_HOST_VALUE,
  SUBTREE_SKIP_TAG_NAMES,
} from "./constants.js";
import { extractBoundingBox, isZeroSizeRect } from "./bounding-box.js";
import { rectArea } from "./geometry.js";
import type { MeasurementRect } from "./types.js";

export function isExtensionRoot(element: Element): boolean {
  if (element.id === OTF_ROOT_HOST_ID) {
    return true;
  }

  if (element.getAttribute(OTF_ROOT_HOST_ATTR) === OTF_ROOT_HOST_VALUE) {
    return true;
  }

  if (element.closest("[data-otf-preview]") !== null) {
    return true;
  }

  return element.closest(`#${OTF_ROOT_HOST_ID}`) !== null;
}

export function isExcludedTagName(tagName: string): boolean {
  return EXCLUDED_TAG_NAMES.has(tagName.trim().toLowerCase());
}

export function isSubtreeSkipTagName(tagName: string): boolean {
  return SUBTREE_SKIP_TAG_NAMES.has(tagName.trim().toLowerCase());
}

export function shouldSkipSubtree(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  return isSubtreeSkipTagName(tagName) || isExtensionRoot(element);
}

export function isGiantPageWrapper(
  element: Element,
  viewport: MatchViewport = getMatchViewport(element.ownerDocument),
): boolean {
  if (isDangerousTagName(element.tagName)) {
    return true;
  }

  const rect = extractBoundingBox(element);
  if (isZeroSizeRect(rect)) {
    return false;
  }

  if (viewport.width <= 0 || viewport.height <= 0) {
    return false;
  }

  const viewportArea = viewport.width * viewport.height;
  if (viewportArea <= 0) {
    return false;
  }

  const areaRatio = rectArea(rect) / viewportArea;
  return areaRatio >= GIANT_NODE_AREA_RATIO;
}

export function shouldExcludeFromMeasurement(
  element: Element,
  options: { includePageLevel?: boolean; viewport?: MatchViewport } = {},
): boolean {
  const tagName = element.tagName.toLowerCase();

  if (isDangerousTagName(tagName) || isExcludedTagName(tagName)) {
    return true;
  }

  if (isExtensionRoot(element)) {
    return true;
  }

  if (!options.includePageLevel && isGiantPageWrapper(element, options.viewport)) {
    return true;
  }

  return false;
}

export function getViewportAreaRatio(rect: MeasurementRect, viewport: MatchViewport): number {
  const viewportArea = viewport.width * viewport.height;
  if (viewportArea <= 0) {
    return 0;
  }

  return rectArea(rect) / viewportArea;
}
