import type { HideOperation } from "../../operations.js";
import type { ElementSnapshotStore } from "../element-snapshot.js";
import type { AppliedDomEffect } from "../types.js";

export function applyHideOperation(
  element: HTMLElement,
  operation: HideOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect {
  const snapshot = snapshotStore.captureIfNeeded(element);
  const previousDisplay = element.style.display || snapshot.display;

  if (operation.payload.hidden) {
    element.style.display = "none";
  } else {
    element.style.display = operation.payload.previousDisplay ?? snapshot.display;
  }

  return {
    operationId: operation.id,
    changes: [{ kind: "display", previousValue: previousDisplay }],
  };
}

export function revertDisplayChange(
  element: HTMLElement,
  change: Extract<AppliedDomEffect["changes"][number], { kind: "display" }>,
): void {
  if (change.previousValue) {
    element.style.display = change.previousValue;
    return;
  }

  element.style.removeProperty("display");
}
