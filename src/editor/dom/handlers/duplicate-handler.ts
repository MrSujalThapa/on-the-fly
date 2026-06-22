import type { DuplicateOperation } from "../../operations.js";
import { buildElementSignature } from "../../measurement/signature-builder.js";
import {
  OTF_CLONE_ATTR,
  applyStyleSnapshot,
} from "../../duplicate/duplicate-element.js";
import { ElementSnapshotStore } from "../element-snapshot.js";
import {
  applyStoredTransformState,
  writeStoredTransformState,
} from "../element-snapshot.js";
import { OTF_MANAGED_ATTR, type AppliedDomEffect, type StoredTransformState } from "../types.js";

export function applyDuplicateOperation(
  document: Document,
  operation: DuplicateOperation,
  snapshotStore: ElementSnapshotStore,
  existing?: HTMLElement | null,
): { element: HTMLElement; changes: AppliedDomEffect["changes"] } {
  const element = existing?.isConnected ? existing : resolveOrCreateClone(document, operation);

  snapshotStore.captureIfNeeded(element);
  applyStyleSnapshot(element, operation.payload.styleSnapshot);

  const previousHtml = element.outerHTML;
  const previousParent = element.parentElement;
  const left = operation.payload.anchorLeft + operation.payload.offsetDx;
  const top = operation.payload.anchorTop + operation.payload.offsetDy;

  document.body.appendChild(element);
  element.setAttribute(OTF_CLONE_ATTR, operation.payload.cloneId);
  element.setAttribute(OTF_MANAGED_ATTR, "true");
  element.style.position = "absolute";
  element.style.left = `${String(left)}px`;
  element.style.top = `${String(top)}px`;
  element.style.width = `${String(operation.payload.anchorWidth)}px`;
  element.style.height = `${String(operation.payload.anchorHeight)}px`;

  const state: StoredTransformState = {
    dx: 0,
    dy: 0,
    width: operation.payload.anchorWidth,
    height: operation.payload.anchorHeight,
    rotate: 0,
    position: "absolute",
  };
  writeStoredTransformState(element, state);
  applyStoredTransformState(element, state);

  const viewport = document.defaultView
    ? { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
    : undefined;
  buildElementSignature(element, { root: document, ...(viewport ? { viewport } : {}) });

  return {
    element,
    changes: [
      {
        kind: "duplicate",
        previousHtml,
        previousParent,
      },
    ],
  };
}

export function revertDuplicateChange(
  element: HTMLElement,
  change: Extract<AppliedDomEffect["changes"][number], { kind: "duplicate" }>,
): void {
  void change;
  element.remove();
}

function resolveOrCreateClone(document: Document, operation: DuplicateOperation): HTMLElement {
  const existing = document.querySelector(
    `[${OTF_CLONE_ATTR}="${operation.payload.cloneId}"]`,
  );
  if (existing instanceof HTMLElement) {
    return existing;
  }

  const template = document.createElement("template");
  template.innerHTML = operation.payload.html.trim();
  const clone = template.content.firstElementChild;
  if (!(clone instanceof HTMLElement)) {
    throw new Error("duplicate_invalid_html");
  }

  clone.setAttribute(OTF_CLONE_ATTR, operation.payload.cloneId);
  document.body.appendChild(clone);
  return clone;
}
