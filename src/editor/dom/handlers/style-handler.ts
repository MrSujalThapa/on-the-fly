import type { StyleOperation, StyleProperty } from "../../operations.js";
import type { ElementSnapshotStore } from "../element-snapshot.js";
import type { AppliedDomEffect } from "../types.js";

const STYLE_PROPERTY_MAP: Record<StyleProperty, string> = {
  color: "color",
  backgroundColor: "background-color",
  backgroundImage: "background-image",
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

export function textSubtreeStyleTargets(element: HTMLElement): HTMLElement[] {
  const document = element.ownerDocument;
  const targets = new Set<HTMLElement>();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("script, style, [hidden], [aria-hidden=true], [data-otf-ui]")) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!(node.textContent ?? "").replace(/[\t\n\f\r ]+/g, "").length) return NodeFilter.FILTER_REJECT;
      const style = document.defaultView?.getComputedStyle(parent);
      return style?.display === "none" || style?.visibility === "hidden"
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent) targets.add(parent);
  }
  return [...targets];
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

  const targets = operation.payload.scope === "text-subtree" ? textSubtreeStyleTargets(element) : [element];
  if (targets.length === 0) throw new Error("style_text_subtree_empty");
  for (const target of targets) target.style.setProperty(cssProperty, operation.payload.value);

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
