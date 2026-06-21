import type { ZIndexOperation } from "../../operations.js";
import type { ElementSnapshotStore } from "../element-snapshot.js";
import type { AppliedDomEffect } from "../types.js";

export function applyZIndexOperation(
  element: HTMLElement,
  operation: ZIndexOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect {
  const snapshot = snapshotStore.captureIfNeeded(element);
  const previousValue = element.style.zIndex || snapshot.zIndex;

  element.style.zIndex = String(operation.payload.layer);

  return {
    operationId: operation.id,
    changes: [{ kind: "zIndex", previousValue }],
  };
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
