import type { TextOperation } from "../../operations.js";
import type { ElementSnapshotStore } from "../element-snapshot.js";
import type { AppliedDomEffect } from "../types.js";

export function applyTextOperation(
  element: HTMLElement,
  operation: TextOperation,
  snapshotStore: ElementSnapshotStore,
): AppliedDomEffect["changes"] {
  snapshotStore.captureIfNeeded(element);
  const previousValue = element.textContent;

  element.textContent = operation.payload.value;

  return [{ kind: "text", previousValue }];
}

export function revertTextChange(
  element: HTMLElement,
  change: Extract<AppliedDomEffect["changes"][number], { kind: "text" }>,
): void {
  element.textContent = change.previousValue;
}
