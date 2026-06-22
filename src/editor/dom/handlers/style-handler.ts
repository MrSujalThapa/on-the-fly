import type { StyleOperation, StyleProperty } from "../../operations.js";
import type { ElementSnapshotStore } from "../element-snapshot.js";
import type { AppliedDomEffect } from "../types.js";

const STYLE_PROPERTY_MAP: Record<StyleProperty, string> = {
  color: "color",
  backgroundColor: "background-color",
  borderColor: "border-color",
  borderWidth: "border-width",
  borderRadius: "border-radius",
  fontSize: "font-size",
  fontWeight: "font-weight",
  textAlign: "text-align",
  opacity: "opacity",
  boxShadow: "box-shadow",
  filter: "filter",
};

function getInlineStyleValue(element: HTMLElement, cssProperty: string): string {
  return element.style.getPropertyValue(cssProperty);
}

function getComputedStyleValue(element: HTMLElement, cssProperty: string): string {
  return getComputedStyle(element).getPropertyValue(cssProperty);
}

export function applyStyleOperation(
  element: HTMLElement,
  operation: StyleOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  snapshotStore.captureIfNeeded(element);

  const cssProperty = STYLE_PROPERTY_MAP[operation.payload.property];
  const inlinePrevious = getInlineStyleValue(element, cssProperty);
  const previousValue =
    inlinePrevious || getComputedStyleValue(element, cssProperty) || operation.payload.previousValue || "";

  element.style.setProperty(cssProperty, operation.payload.value);

  return [{ kind: "style", property: cssProperty, previousValue }];
}

export function revertStyleChange(
  element: HTMLElement,
  change: Extract<AppliedDomEffect["changes"][number], { kind: "style" }>,
): void {
  if (change.previousValue) {
    element.style.setProperty(change.property, change.previousValue);
    return;
  }

  element.style.removeProperty(change.property);
}
