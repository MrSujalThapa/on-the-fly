import { buildElementSignature } from "../../measurement/signature-builder.js";
import type {
  HelperObjectBorder,
  HelperObjectBoxShadow,
  HelperObjectFill,
  InsertHelperObjectOperation,
} from "../../operations.js";
import {
  applyStoredTransformState,
  type ElementSnapshotStore,
  writeStoredTransformState,
} from "../element-snapshot.js";
import {
  OTF_HELPER_ATTR,
  OTF_HELPER_ROLE_ATTR,
  OTF_MANAGED_ATTR,
  type AppliedDomEffect,
  type StoredTransformState,
} from "../types.js";

const HELPER_CLASS = "otf-helper-object";

export function applyInsertHelperObjectOperation(
  document: Document,
  operation: InsertHelperObjectOperation,
  snapshotStore: ElementSnapshotStore,
  existing?: HTMLElement | null,
): { element: HTMLElement; changes: AppliedDomEffect["changes"] } {
  const element = existing?.isConnected ? existing : resolveOrCreateHelper(document, operation);
  snapshotStore.captureIfNeeded(element);

  applyHelperObjectPayload(element, operation);

  const state: StoredTransformState = {
    dx: 0,
    dy: 0,
    width: operation.payload.rect.width,
    height: operation.payload.rect.height,
    rotate: 0,
    position: "absolute",
  };
  writeStoredTransformState(element, state);
  applyStoredTransformState(element, state);

  const viewport = document.defaultView
    ? { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
    : undefined;
  buildElementSignature(element, { root: document, ...(viewport ? { viewport } : {}) });

  return { element, changes: [] };
}

function resolveOrCreateHelper(
  document: Document,
  operation: InsertHelperObjectOperation,
): HTMLElement {
  const existing = document.querySelector(
    `[${OTF_HELPER_ATTR}="${operation.payload.helperId}"]`,
  );
  if (existing instanceof HTMLElement) {
    return existing;
  }

  const element = document.createElement("div");
  element.id = helperElementId(operation.payload.helperId);
  element.className = HELPER_CLASS;
  document.body.appendChild(element);
  return element;
}

function applyHelperObjectPayload(
  element: HTMLElement,
  operation: InsertHelperObjectOperation,
): void {
  const { payload } = operation;
  element.setAttribute(OTF_MANAGED_ATTR, "true");
  element.setAttribute(OTF_HELPER_ATTR, payload.helperId);
  element.setAttribute(OTF_HELPER_ROLE_ATTR, payload.role);
  element.setAttribute("data-otf-object", "helper");
  element.style.position = "absolute";
  element.style.left = `${String(payload.rect.x)}px`;
  element.style.top = `${String(payload.rect.y)}px`;
  element.style.width = `${String(payload.rect.width)}px`;
  element.style.height = `${String(payload.rect.height)}px`;
  element.style.boxSizing = "border-box";
  element.style.pointerEvents =
    payload.role === "backgroundPanel" && operation.status === "preview" ? "none" : "auto";

  applyFill(element, payload.fill);
  setOrRemoveStyle(element, "border-radius", payload.borderRadius);
  setOrRemoveStyle(
    element,
    "opacity",
    payload.opacity === undefined ? undefined : String(payload.opacity),
  );
  setOrRemoveStyle(element, "box-shadow", formatBoxShadow(payload.boxShadow));
  setOrRemoveStyle(
    element,
    "z-index",
    payload.zIndex === undefined ? undefined : String(payload.zIndex),
  );
  setOrRemoveStyle(element, "border", formatBorder(payload.border));

  if (payload.label?.trim()) {
    element.setAttribute("aria-label", payload.label.trim());
    element.removeAttribute("aria-hidden");
  } else {
    element.setAttribute("aria-hidden", "true");
    element.removeAttribute("aria-label");
  }
}

function applyFill(element: HTMLElement, fill: HelperObjectFill | undefined): void {
  element.style.removeProperty("background-color");
  element.style.removeProperty("background-image");
  if (!fill) {
    return;
  }

  if (fill.type === "solid") {
    element.style.backgroundColor = fill.color;
    return;
  }

  element.style.backgroundImage = `linear-gradient(${String(fill.angleDeg)}deg, ${fill.stops
    .map((stop) => `${stop.color} ${String(stop.position)}%`)
    .join(", ")})`;
}

function formatBorder(border: HelperObjectBorder | undefined): string | undefined {
  return border ? `${String(border.width)}px ${border.style} ${border.color}` : undefined;
}

function formatBoxShadow(boxShadow: HelperObjectBoxShadow | undefined): string | undefined {
  if (!boxShadow) {
    return undefined;
  }

  return [
    `${String(boxShadow.offsetX)}px`,
    `${String(boxShadow.offsetY)}px`,
    `${String(boxShadow.blurRadius)}px`,
    `${String(boxShadow.spreadRadius ?? 0)}px`,
    boxShadow.color,
  ].join(" ");
}

function setOrRemoveStyle(element: HTMLElement, property: string, value: string | undefined): void {
  if (value === undefined || value.trim() === "") {
    element.style.removeProperty(property);
    return;
  }
  element.style.setProperty(property, value);
}

function helperElementId(helperId: string): string {
  return `otf-helper-${helperId}`;
}
