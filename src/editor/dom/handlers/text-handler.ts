import type { TextOperation } from "../../operations.js";
import type { ElementSnapshotStore } from "../element-snapshot.js";
import type { AppliedDomEffect } from "../types.js";
import { applyCreatedPrimaryText, createdPrimaryText } from "../../create/render-created-element.js";
import { OTF_ELEMENT_ID_ATTR } from "../../create/created-element.js";

function collectTextNodes(element: HTMLElement): Text[] {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

function isVisibleTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent || parent.closest("script, style, [hidden], [aria-hidden=true], [data-otf-ui]")) return false;
  const style = parent.ownerDocument.defaultView?.getComputedStyle(parent);
  return !(style?.display === "none" || style?.visibility === "hidden");
}

export function renderedVisibleText(element: HTMLElement): string {
  const created = createdPrimaryText(element);
  if (created !== null) return created;
  if (element instanceof HTMLInputElement) return element.placeholder.trim();
  let value = "";
  for (const node of collectTextNodes(element)) {
    if (isVisibleTextNode(node)) value += node.data;
  }
  return value.replace(/[\t\n\f\r ]+/g, " ").trim();
}

export function applyTextOperation(
  element: HTMLElement,
  operation: TextOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  snapshotStore.captureIfNeeded(element);
  if (element.hasAttribute(OTF_ELEMENT_ID_ATTR)) {
    const previousValue = createdPrimaryText(element) ?? "";
    if (applyCreatedPrimaryText(element, operation.payload.value)) {
      return [{ kind: "text", previousValue }];
    }
  }
  const previousValue = element.textContent;
  const nodes = collectTextNodes(element);
  const previousTextNodes = nodes.map((node) => node.data);
  const visible = nodes.filter(isVisibleTextNode);
  if (visible.length === 0) {
    element.append(element.ownerDocument.createTextNode(operation.payload.value));
  } else {
    const first = visible[0];
    if (first) first.data = operation.payload.value;
    for (const node of visible.slice(1)) node.data = "";
  }

  return [{ kind: "text", previousValue, previousTextNodes }];
}

export function revertTextChange(
  element: HTMLElement,
  change: Extract<AppliedDomEffect["changes"][number], { kind: "text" }>,
): void {
  if (element.hasAttribute(OTF_ELEMENT_ID_ATTR) && applyCreatedPrimaryText(element, change.previousValue)) {
    return;
  }
  if (!change.previousTextNodes) {
    element.textContent = change.previousValue;
    return;
  }
  const nodes = collectTextNodes(element);
  if (nodes.length !== change.previousTextNodes.length) {
    element.textContent = change.previousValue;
    return;
  }
  nodes.forEach((node, index) => { node.data = change.previousTextNodes?.[index] ?? ""; });
}
