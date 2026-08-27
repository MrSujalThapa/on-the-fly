import { OTF_CLONE_ATTR } from "../../editor/duplicate/duplicate-element.js";
import { OTF_ELEMENT_ID_ATTR } from "../../editor/create/created-element.js";
import { readStoredTransformState } from "../../editor/dom/element-snapshot.js";
import type { PlacementEngine } from "../placement-engine.js";
import type { ComputedStyleSnapshot, ElementOrigin, GeometrySnapshot } from "./environment-types.js";

const STYLE_KEYS = [
  "display", "position", "visibility", "opacity", "width", "height", "color", "backgroundColor", "backgroundImage",
  "fontFamily", "fontSize", "fontWeight", "lineHeight", "border", "borderRadius", "boxShadow", "overflowX", "overflowY",
  "zIndex", "flexDirection", "alignItems", "justifyContent", "gap", "gridTemplateColumns", "gridTemplateRows",
] as const;

export function originOf(element: HTMLElement): ElementOrigin {
  if (element.hasAttribute(OTF_ELEMENT_ID_ATTR)) return "created";
  if (element.hasAttribute(OTF_CLONE_ATTR)) return "clone";
  return "host";
}

export function textOf(element: HTMLElement): string {
  return (element.getAttribute("aria-label") || element.innerText || "").replace(/\s+/g, " ").trim();
}

export function geometryOf(element: HTMLElement, placement: PlacementEngine): GeometrySnapshot {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, left: rect.left, right: rect.right,
    bottom: rect.bottom, rotation: readStoredTransformState(element)?.rotate ?? 0,
    placement: placement.isIndependent(element) ? "independent" : "attached" };
}

export function stylesOf(element: HTMLElement): ComputedStyleSnapshot {
  const styles = element.ownerDocument.defaultView?.getComputedStyle(element);
  return Object.fromEntries(STYLE_KEYS.map((key) => [key, styles?.[key] ?? ""])) as unknown as ComputedStyleSnapshot;
}

export function visible(element: HTMLElement): boolean {
  const styles = element.ownerDocument.defaultView?.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return element.isConnected && rect.width > 0 && rect.height > 0 && styles?.display !== "none" && styles?.visibility !== "hidden" && styles?.opacity !== "0";
}
