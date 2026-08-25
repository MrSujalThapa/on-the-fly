import { isExtensionRoot } from "../../editor/measurement/scan-guards.js";
import { OTF_ELEMENT_ID_ATTR, OTF_PREVIEW_ATTR } from "../../editor/create/created-element.js";
import { OTF_CLONE_ATTR } from "../../editor/duplicate/duplicate-element.js";
import { readStoredTransformState } from "../../editor/dom/element-snapshot.js";
import { renderedVisibleText } from "../../editor/dom/handlers/text-handler.js";
import { buildLassoSampleGrid } from "../lasso-selection.js";
import type { VisualModel } from "../visual-model.js";
import type { PlacementEngine } from "../placement-engine.js";
import type {
  ComputedStyleSnapshot,
  ElementId,
  ElementOrigin,
  ElementSummary,
  GeometrySnapshot,
  ViewportSnapshot,
} from "./environment-types.js";

const STYLE_KEYS = [
  "display", "position", "visibility", "opacity",
  "width", "height",
  "color", "backgroundColor", "backgroundImage",
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "textAlign",
  "borderWidth", "borderColor", "borderRadius",
  "boxShadow",
  "overflowX", "overflowY",
  "zIndex",
  "flexDirection", "alignItems", "justifyContent", "gap",
  "gridTemplateColumns", "gridTemplateRows",
] as const;

export function readViewport(document: Document): ViewportSnapshot {
  const view = document.defaultView;
  return {
    width: view?.innerWidth ?? 0,
    height: view?.innerHeight ?? 0,
    scrollX: view?.scrollX ?? 0,
    scrollY: view?.scrollY ?? 0,
  };
}

export function elementOrigin(element: HTMLElement): ElementOrigin {
  if (element.getAttribute(OTF_ELEMENT_ID_ATTR)?.trim()) return "created";
  if (element.getAttribute(OTF_CLONE_ATTR)?.trim()) return "clone";
  return "host";
}

export function visibleTextOf(element: HTMLElement): string {
  return (element.getAttribute("aria-label")?.trim() || renderedVisibleText(element) || "").replace(/\s+/g, " ").trim();
}

export function geometryOf(element: HTMLElement, placement: PlacementEngine): GeometrySnapshot {
  const box = element.getBoundingClientRect();
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    top: box.top,
    left: box.left,
    right: box.right,
    bottom: box.bottom,
    rotation: readStoredTransformState(element)?.rotate ?? 0,
    placement: placement.isIndependent(element) ? "independent" : "attached",
  };
}

export function computedStylesOf(element: HTMLElement): ComputedStyleSnapshot {
  const styles = element.ownerDocument.defaultView?.getComputedStyle(element);
  const read = (key: typeof STYLE_KEYS[number]): string => {
    if (!styles) return "";
    const value = styles[key];
    return typeof value === "string" ? value : "";
  };
  return Object.fromEntries(STYLE_KEYS.map((key) => [key, read(key)])) as unknown as ComputedStyleSnapshot;
}

export function intersectsViewport(geometry: GeometrySnapshot, viewport: ViewportSnapshot): boolean {
  return geometry.right > 0 && geometry.bottom > 0 && geometry.left < viewport.width && geometry.top < viewport.height
    && geometry.width > 0 && geometry.height > 0;
}

function isVisibleStyle(element: HTMLElement): boolean {
  const styles = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!styles) return element.isConnected;
  return styles.display !== "none" && styles.visibility !== "hidden" && styles.opacity !== "0";
}

export function collectObservableIds(
  document: Document,
  visualModel: VisualModel,
  selected: readonly ElementId[],
): ElementId[] {
  const ids = new Set<ElementId>([...visualModel.knownIds(), ...selected]);
  const viewport = readViewport(document);
  if (viewport.width > 0 && viewport.height > 0 && typeof document.elementsFromPoint === "function") {
    for (const point of buildLassoSampleGrid({ x: 0, y: 0, width: viewport.width, height: viewport.height })) {
      const picked = visualModel.pick(point.x, point.y);
      if (picked) ids.add(picked);
    }
  }
  const managed = document.querySelectorAll(`[${OTF_ELEMENT_ID_ATTR}]:not([${OTF_PREVIEW_ATTR}]), [${OTF_CLONE_ATTR}]`);
  for (const node of Array.from(managed)) {
    if (!(node instanceof HTMLElement) || isExtensionRoot(node)) continue;
    const adopted = visualModel.adopt(node);
    if (adopted) ids.add(adopted);
  }
  return [...ids];
}

export function summarizeElement(
  id: ElementId,
  element: HTMLElement,
  selected: ReadonlySet<ElementId>,
  placement: PlacementEngine,
): ElementSummary {
  const geometry = geometryOf(element, placement);
  const role = element.getAttribute("role")?.trim();
  const text = visibleTextOf(element);
  return {
    id,
    origin: elementOrigin(element),
    tag: element.tagName.toLowerCase(),
    ...(role ? { role } : {}),
    ...(text ? { text: text.slice(0, 120) } : {}),
    bounds: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
    selected: selected.has(id),
  };
}

export function isVisuallyQueryable(element: HTMLElement, geometry: GeometrySnapshot, viewport: ViewportSnapshot): boolean {
  return element.isConnected && !isExtensionRoot(element) && isVisibleStyle(element) && intersectsViewport(geometry, viewport);
}
