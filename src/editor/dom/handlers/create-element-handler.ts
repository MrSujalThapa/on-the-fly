import type { CreateElementOperation } from "../../operations.js";
import { buildElementSignature } from "../../measurement/signature-builder.js";
import { type ElementSnapshotStore } from "../element-snapshot.js";
import { realizeIndependentPlacement } from "../managed-detach.js";
import type { AppliedDomEffect } from "../types.js";
import { OTF_ELEMENT_ID_ATTR } from "../../create/created-element.js";
import { renderCreatedElement } from "../../create/render-created-element.js";

export function applyCreateElementOperation(
  document: Document,
  operation: CreateElementOperation,
  snapshotStore: ElementSnapshotStore,
  existing?: HTMLElement | null,
): { element: HTMLElement; changes: AppliedDomEffect["changes"] } {
  const element = existing?.isConnected ? existing : resolveOrCreate(document, operation);
  snapshotStore.captureIfNeeded(element);
  realizeIndependentPlacement(element, operation.payload.rect);
  const viewport = document.defaultView
    ? { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
    : undefined;
  buildElementSignature(element, { root: document, ...(viewport ? { viewport } : {}) });
  return { element, changes: [] };
}

function resolveOrCreate(document: Document, operation: CreateElementOperation): HTMLElement {
  const existing = document.querySelector(`[${OTF_ELEMENT_ID_ATTR}="${operation.payload.elementId}"]`);
  if (existing instanceof HTMLElement) return existing;
  const element = renderCreatedElement(document, {
    elementId: operation.payload.elementId,
    kind: operation.payload.kind,
    rect: operation.payload.rect,
    content: operation.payload.content,
    appearance: operation.payload.appearance,
  });
  document.body.appendChild(element);
  return element;
}
