import { MIN_VISIBLE_SIZE_PX } from "./constants.js";
import { extractBoundingBox, isZeroSizeRect } from "./bounding-box.js";
import { snapshotComputedStyles } from "./computed-styles.js";

export function isElementVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const rect = extractBoundingBox(element);
  if (isZeroSizeRect(rect)) {
    return false;
  }

  if (rect.width < MIN_VISIBLE_SIZE_PX || rect.height < MIN_VISIBLE_SIZE_PX) {
    return false;
  }

  const computed = snapshotComputedStyles(element);
  if (computed.display === "none") {
    return false;
  }

  const inlineVisibility = element.style.visibility;
  if (inlineVisibility === "hidden" || inlineVisibility === "collapse") {
    return false;
  }

  if (computed.opacity === "0") {
    return false;
  }

  return true;
}

export function filterVisibleElements(elements: Iterable<Element>): Element[] {
  return Array.from(elements).filter((element) => isElementVisible(element));
}
