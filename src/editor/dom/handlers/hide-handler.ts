import type { HideOperation } from "../../operations.js";
import type { ElementSnapshotStore } from "../element-snapshot.js";
import type { AppliedDomEffect } from "../types.js";

export function applyHideOperation(
  element: HTMLElement,
  operation: HideOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  const snapshot = snapshotStore.captureIfNeeded(element);
  const previousDisplay = element.style.display || snapshot.display;

  if (operation.payload.hidden) {
    element.style.setProperty("display", "none", "important");
    element.setAttribute("data-otf-hidden", "true");
  } else {
    element.removeAttribute("data-otf-hidden");
    if (operation.payload.previousDisplay ?? snapshot.display) {
      element.style.display = operation.payload.previousDisplay ?? snapshot.display;
    } else {
      element.style.removeProperty("display");
    }
  }

  return [{ kind: "display", previousValue: previousDisplay }];
}

export function revertDisplayChange(
  element: HTMLElement,
  change: Extract<AppliedDomEffect["changes"][number], { kind: "display" }>,
): void {
  element.removeAttribute("data-otf-hidden");
  if (change.previousValue) {
    element.style.display = change.previousValue;
    return;
  }

  element.style.removeProperty("display");
}
