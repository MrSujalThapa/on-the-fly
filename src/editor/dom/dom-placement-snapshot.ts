import { OTF_CLONE_ATTR } from "../duplicate/duplicate-element.js";
import { extractBoundingBox } from "../measurement/bounding-box.js";
import { buildCssPath } from "../measurement/signature-builder.js";
import type { MeasurementRect } from "../measurement/types.js";
import {
  captureElementSnapshot,
  restoreInlineStyleFromSnapshot,
} from "./element-snapshot.js";
import type { ElementStyleSnapshot } from "./types.js";
import { OTF_DETACH_ATTR } from "./managed-detach.js";
import { OTF_CROP_ATTR, OTF_MANAGED_ATTR, OTF_TRANSFORM_ATTR } from "./types.js";
import {
  applyStoredTransformState,
  writeStoredTransformState,
} from "./element-snapshot.js";

export type DomRectSnapshot = MeasurementRect;

export interface DomPlacementSnapshot {
  parentCssPath: string | null;
  nextSiblingCssPath: string | null;
  inlineStyle: string;
  detached: boolean;
  managed: boolean;
  cloneId: string | null;
}

export interface ElementDomSnapshot {
  /** False when the element did not exist before an operation (e.g. duplicate insert). */
  existed: boolean;
  placement: DomPlacementSnapshot;
  rect: DomRectSnapshot;
  styleSnapshot: ElementStyleSnapshot;
  transformAttr: string | null;
  cropAttr: string | null;
}

export function elementSnapshotKey(element: HTMLElement, root: ParentNode): string {
  const cloneId = element.getAttribute(OTF_CLONE_ATTR);
  if (cloneId) {
    return `clone:${cloneId}`;
  }

  return `path:${buildCssPath(element, root)}`;
}

export function captureElementDomSnapshot(
  element: HTMLElement,
  root: ParentNode,
  options: { existed?: boolean } = {},
): ElementDomSnapshot {
  const parent = element.parentElement;
  const nextSibling = element.nextElementSibling;

  return {
    existed: options.existed ?? element.isConnected,
    placement: {
      parentCssPath: parent ? buildCssPath(parent, root) : null,
      nextSiblingCssPath:
        nextSibling instanceof HTMLElement ? buildCssPath(nextSibling, root) : null,
      inlineStyle: element.getAttribute("style") ?? "",
      detached: element.getAttribute(OTF_DETACH_ATTR) === "true",
      managed: element.hasAttribute(OTF_MANAGED_ATTR),
      cloneId: element.getAttribute(OTF_CLONE_ATTR),
    },
    rect: extractBoundingBox(element),
    styleSnapshot: captureElementSnapshot(element),
    transformAttr: element.getAttribute(OTF_TRANSFORM_ATTR),
    cropAttr: element.getAttribute(OTF_CROP_ATTR),
  };
}

export function captureMissingElementDomSnapshot(): ElementDomSnapshot {
  return {
    existed: false,
    placement: {
      parentCssPath: null,
      nextSiblingCssPath: null,
      inlineStyle: "",
      detached: false,
      managed: false,
      cloneId: null,
    },
    rect: { x: 0, y: 0, width: 0, height: 0 },
    styleSnapshot: {
      inlineStyle: "",
      presentationCssText: "",
      display: "",
      visibility: "",
      transform: "",
      width: "",
      height: "",
      zIndex: "",
      position: "",
      textContent: "",
    },
    transformAttr: null,
    cropAttr: null,
  };
}

function resolveElementByCssPath(root: ParentNode, cssPath: string | null): HTMLElement | null {
  if (!cssPath) {
    return null;
  }

  const document = root instanceof Document ? root : root.ownerDocument;
  if (!document) {
    return null;
  }

  try {
    const match = document.querySelector(cssPath);
    return match instanceof HTMLElement ? match : null;
  } catch {
    return null;
  }
}

function resolveCloneElement(root: ParentNode, cloneId: string | null): HTMLElement | null {
  if (!cloneId) {
    return null;
  }

  const document = root instanceof Document ? root : root.ownerDocument;
  if (!document) {
    return null;
  }

  const match = document.querySelector(`[${OTF_CLONE_ATTR}="${cloneId}"]`);
  return match instanceof HTMLElement ? match : null;
}

export function resolveSnapshotElement(
  root: ParentNode,
  snapshot: ElementDomSnapshot,
  current?: HTMLElement | null,
): HTMLElement | null {
  if (current?.isConnected) {
    return current;
  }

  const clone = resolveCloneElement(root, snapshot.placement.cloneId);
  if (clone) {
    return clone;
  }

  const parentPath = snapshot.placement.parentCssPath;
  if (!parentPath) {
    return null;
  }

  const parent = resolveElementByCssPath(root, parentPath);
  if (!parent) {
    return null;
  }

  const nextPath = snapshot.placement.nextSiblingCssPath;
  if (!nextPath) {
    return parent.lastElementChild instanceof HTMLElement ? parent.lastElementChild : null;
  }

  const nextSibling = resolveElementByCssPath(root, nextPath);
  if (nextSibling?.parentElement === parent) {
    return nextSibling.previousElementSibling instanceof HTMLElement
      ? nextSibling.previousElementSibling
      : null;
  }

  return null;
}

function insertElementAtPlacement(
  root: ParentNode,
  element: HTMLElement,
  placement: DomPlacementSnapshot,
): void {
  const parent =
    resolveElementByCssPath(root, placement.parentCssPath) ??
    (root instanceof Document ? root.body : null);
  if (!parent) {
    return;
  }

  const nextSibling = resolveElementByCssPath(root, placement.nextSiblingCssPath);
  if (nextSibling && nextSibling.parentElement === parent) {
    parent.insertBefore(element, nextSibling);
    return;
  }

  parent.appendChild(element);
}

function applyPlacementAttributes(element: HTMLElement, placement: DomPlacementSnapshot): void {
  if (placement.detached) {
    element.setAttribute(OTF_DETACH_ATTR, "true");
  } else {
    element.removeAttribute(OTF_DETACH_ATTR);
  }

  if (placement.managed) {
    element.setAttribute(OTF_MANAGED_ATTR, "true");
  } else {
    element.removeAttribute(OTF_MANAGED_ATTR);
  }

  if (placement.cloneId) {
    element.setAttribute(OTF_CLONE_ATTR, placement.cloneId);
  } else {
    element.removeAttribute(OTF_CLONE_ATTR);
  }
}

function applyTransformAndCropAttributes(
  element: HTMLElement,
  snapshot: ElementDomSnapshot,
): void {
  if (snapshot.transformAttr) {
    element.setAttribute(OTF_TRANSFORM_ATTR, snapshot.transformAttr);
    const parsed = JSON.parse(snapshot.transformAttr) as {
      dx: number;
      dy: number;
      rotate: number;
      position: string;
      width: number | null;
      height: number | null;
    };
    applyStoredTransformState(element, parsed);
  } else {
    writeStoredTransformState(element, null);
    element.style.removeProperty("transform");
  }

  if (snapshot.cropAttr) {
    element.setAttribute(OTF_CROP_ATTR, snapshot.cropAttr);
  } else {
    element.removeAttribute(OTF_CROP_ATTR);
  }
}

export function restoreElementDomSnapshot(
  root: ParentNode,
  snapshot: ElementDomSnapshot,
  element: HTMLElement | null,
): void {
  if (!snapshot.existed) {
    element?.remove();
    return;
  }

  const target = element ?? resolveSnapshotElement(root, snapshot);
  if (!target) {
    return;
  }

  if (!target.isConnected) {
    insertElementAtPlacement(root, target, snapshot.placement);
  } else {
    const parent = resolveElementByCssPath(root, snapshot.placement.parentCssPath);
    const nextSibling = resolveElementByCssPath(root, snapshot.placement.nextSiblingCssPath);
    if (parent && target.parentElement !== parent) {
      insertElementAtPlacement(root, target, snapshot.placement);
    } else if (parent && nextSibling && target.nextElementSibling !== nextSibling) {
      parent.insertBefore(target, nextSibling);
    }
  }

  restoreInlineStyleFromSnapshot(target, snapshot.styleSnapshot);
  // Restore text content only when the element is currently a text leaf (no
  // child elements) and the text actually changed. Move/resize/style/hide/crop
  // never alter text, so a container keeps its children untouched. Text edits
  // (and any op that flattens an element to text) leave the element childless,
  // so their text is restored correctly. This prevents undo/redo/clear from
  // wiping a card's subtree while still reverting genuine text changes.
  if (
    target.childElementCount === 0 &&
    target.textContent !== snapshot.styleSnapshot.textContent
  ) {
    target.textContent = snapshot.styleSnapshot.textContent;
  }
  applyPlacementAttributes(target, snapshot.placement);
  applyTransformAndCropAttributes(target, snapshot);
}
