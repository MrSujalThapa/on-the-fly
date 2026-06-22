import type { OperationId } from "../ids.js";

let counter = 0;

/**
 * Generates a process-unique operation id. Tests can inject their own factory
 * where determinism matters; this default is only used at runtime.
 */
export function createOperationId(): OperationId {
  counter += 1;
  return `otf-op-${Date.now().toString(36)}-${counter.toString(36)}`;
}
