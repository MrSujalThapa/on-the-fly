import type { EditorOperation } from "../editor/operations.js";

export function freezeCommittedOperation<T extends EditorOperation>(operation: T): T {
  Object.freeze(operation.payload);
  if (operation.metadata) {
    Object.freeze(operation.metadata);
  }
  return Object.freeze(operation);
}
