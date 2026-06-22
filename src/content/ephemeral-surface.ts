import { isExtensionRoot } from "../editor/measurement/scan-guards.js";

export const FLOATING_SURFACE_ROLES = new Set([
  "menu",
  "listbox",
  "dialog",
  "tooltip",
  "navigation",
  "grid",
  "tree",
  "combobox",
]);

export interface EphemeralSurfaceSnapshot {
  roots: HTMLElement[];
  triggers: HTMLElement[];
  detection: "role" | "position" | "aria-expanded" | "pointer" | "none";
}

export interface DetectEphemeralSurfacesOptions {
  document: Document;
  pointer?: { x: number; y: number } | null;
  activeElement?: Element | null;
}

/**
 * Returns true when the element sits inside a floating dropdown/popover surface
 * that is unlikely to survive page refresh or replay.
 */
export function isInsideEphemeralSurface(element: Element, document: Document): boolean {
  const snapshot = detectEphemeralSurfaces({ document });
  for (const root of snapshot.roots) {
    if (root === element || root.contains(element)) {
      return true;
    }
  }
  return false;
}

export function detectEphemeralSurfaces(
  options: DetectEphemeralSurfacesOptions,
): EphemeralSurfaceSnapshot {
  const { document, pointer, activeElement } = options;
  const roots = new Map<HTMLElement, EphemeralSurfaceSnapshot["detection"]>();
  const triggers = new Set<HTMLElement>();

  collectRoleSurfaces(document, roots);
  collectAriaExpandedSurfaces(document, roots, triggers);
  if (pointer) {
    collectPointerStackSurfaces(document, pointer.x, pointer.y, roots, triggers);
  }
  if (activeElement instanceof HTMLElement) {
    collectNearbyPositionedSurfaces(document, activeElement, roots);
    if (activeElement.matches('[aria-expanded="true"]')) {
      triggers.add(activeElement);
    }
  }

  const rootList = [...roots.keys()];
  if (rootList.length > 0) {
    const firstRoot = rootList[0];
    const detection = firstRoot ? (roots.get(firstRoot) ?? "role") : "role";
    return {
      roots: rootList,
      triggers: [...triggers],
      detection,
    };
  }

  return {
    roots: [],
    triggers: [],
    detection: "none",
  };
}

function collectRoleSurfaces(
  document: Document,
  roots: Map<HTMLElement, EphemeralSurfaceSnapshot["detection"]>,
): void {
  for (const role of FLOATING_SURFACE_ROLES) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(`[role="${role}"]`))) {
      if (isCandidateSurface(element)) {
        roots.set(element, "role");
      }
    }
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[popover]"))) {
    if (element.matches(":popover-open") && isCandidateSurface(element)) {
      roots.set(element, "role");
    }
  }
}

function collectAriaExpandedSurfaces(
  document: Document,
  roots: Map<HTMLElement, EphemeralSurfaceSnapshot["detection"]>,
  triggers: Set<HTMLElement>,
): void {
  for (const trigger of Array.from(document.querySelectorAll<HTMLElement>('[aria-expanded="true"]'))) {
    triggers.add(trigger);
    const controlId = trigger.getAttribute("aria-controls");
    if (controlId) {
      const controlled = document.getElementById(controlId);
      if (controlled instanceof HTMLElement && isCandidateSurface(controlled)) {
        roots.set(controlled, "aria-expanded");
        continue;
      }
    }

    const described = findVisiblePositionedPanelNear(trigger, document);
    if (described) {
      roots.set(described, "aria-expanded");
    }
  }
}

function collectPointerStackSurfaces(
  document: Document,
  x: number,
  y: number,
  roots: Map<HTMLElement, EphemeralSurfaceSnapshot["detection"]>,
  triggers: Set<HTMLElement>,
): void {
  if (typeof document.elementsFromPoint !== "function") {
    return;
  }

  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (!(node instanceof HTMLElement) || isExtensionRoot(node)) {
      continue;
    }

    const role = node.getAttribute("role");
    if (role && FLOATING_SURFACE_ROLES.has(role) && isCandidateSurface(node)) {
      roots.set(node, "pointer");
    }

    if (isFloatingPositionedPanel(node) && isCandidateSurface(node)) {
      roots.set(node, "pointer");
    }

    if (node.matches('[aria-expanded="true"]')) {
      triggers.add(node);
    }
  }
}

function collectNearbyPositionedSurfaces(
  document: Document,
  anchor: HTMLElement,
  roots: Map<HTMLElement, EphemeralSurfaceSnapshot["detection"]>,
): void {
  const panel = findVisiblePositionedPanelNear(anchor, document);
  if (panel) {
    roots.set(panel, "position");
  }
}

function findVisiblePositionedPanelNear(
  anchor: HTMLElement,
  document: Document,
): HTMLElement | null {
  const anchorRect = anchor.getBoundingClientRect();
  let best: { element: HTMLElement; score: number } | null = null;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node instanceof HTMLElement && node !== anchor && isFloatingPositionedPanel(node)) {
      if (!isCandidateSurface(node)) {
        node = walker.nextNode();
        continue;
      }

      const rect = node.getBoundingClientRect();
      const score = proximityScore(anchorRect, rect);
      if (score > 0 && (!best || score > best.score)) {
        best = { element: node, score };
      }
    }
    node = walker.nextNode();
  }

  return best?.element ?? null;
}

function proximityScore(anchor: DOMRect, panel: DOMRect): number {
  const dx = Math.max(0, Math.max(anchor.left - panel.right, panel.left - anchor.right));
  const dy = Math.max(0, Math.max(anchor.top - panel.bottom, panel.top - anchor.bottom));
  const distance = Math.hypot(dx, dy);
  if (distance > 240) {
    return 0;
  }
  return 1000 - distance + panel.width * panel.height * 0.01;
}

function isFloatingPositionedPanel(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return false;
  }
  const style = view.getComputedStyle(element);
  if (style.position !== "fixed" && style.position !== "absolute") {
    return false;
  }
  const zIndex = Number.parseInt(style.zIndex, 10);
  return Number.isFinite(zIndex) ? zIndex >= 10 : style.zIndex === "auto";
}

function isCandidateSurface(element: HTMLElement): boolean {
  if (!element.isConnected || isExtensionRoot(element)) {
    return false;
  }
  const tag = element.tagName.toLowerCase();
  if (tag === "html" || tag === "body" || tag === "main") {
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
  if (rect.width < 8 || rect.height < 8) {
    return false;
  }

  return true;
}
