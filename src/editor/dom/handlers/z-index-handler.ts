import type { ZIndexOperation } from "../../operations.js";
import type { ElementSnapshotStore } from "../element-snapshot.js";
import type { AppliedDomEffect } from "../types.js";

export function applyZIndexOperation(
  element: HTMLElement,
  operation: ZIndexOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  const snapshot = snapshotStore.captureIfNeeded(element);
  const previousValue = element.style.zIndex || snapshot.zIndex;
  const changes: AppliedDomEffect["changes"] = [];

  // z-index only affects stacking on a positioned element. If the element is
  // statically positioned, promote it to `relative` (no layout shift) so the
  // layer change is actually honoured by the browser.
  const computedPosition = readComputedPosition(element);
  if (computedPosition === "static") {
    const previousPosition = element.style.position;
    element.style.position = "relative";
    changes.push({ kind: "position", previousValue: previousPosition });
  }

  element.style.zIndex = String(operation.payload.layer);
  changes.push({ kind: "zIndex", previousValue });

  return changes;
}

function readComputedPosition(element: HTMLElement): string {
  const inline = element.style.position;
  if (inline) {
    return inline;
  }

  const view = element.ownerDocument.defaultView;
  if (view) {
    return view.getComputedStyle(element).position || "static";
  }

  return "static";
}

export function revertPositionChange(
  element: HTMLElement,
  change: Extract<AppliedDomEffect["changes"][number], { kind: "position" }>,
): void {
  if (change.previousValue) {
    element.style.position = change.previousValue;
    return;
  }

  element.style.removeProperty("position");
}

export function revertZIndexChange(
  element: HTMLElement,
  change: Extract<AppliedDomEffect["changes"][number], { kind: "zIndex" }>,
): void {
  if (change.previousValue && change.previousValue !== "auto") {
    element.style.zIndex = change.previousValue;
    return;
  }

  element.style.removeProperty("z-index");
}
