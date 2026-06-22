import type { EditorOperation } from "../operations.js";

/** Stable key for matching operations that affect the same DOM target. */
export function operationTargetKey(operation: EditorOperation): string | null {
  const cssPath = operation.target.signature?.cssPath;
  if (cssPath) {
    return `sig:${cssPath}`;
  }

  const nodeId = operation.target.nodeId;
  if (nodeId) {
    return `node:${nodeId}`;
  }

  return null;
}

/** Returns the effective hidden state from saved ops, or `null` when visible/default. */
export function effectiveHideState(
  operations: EditorOperation[],
  targetKey: string,
): boolean | null {
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    const operation = operations[index];
    if (!operation || operation.type !== "hide") {
      continue;
    }
    if (operationTargetKey(operation) === targetKey) {
      return operation.payload.hidden;
    }
  }
  return null;
}

export interface CoalesceResult {
  operations: EditorOperation[];
  applied: number;
  skipped: number;
}

/**
 * Merges incoming operations into the existing page list. Hide ops for the same
 * target collapse to a single final hide record; repeated hide or redundant
 * show ops are dropped.
 */
export function coalescePageOperations(
  existing: EditorOperation[],
  incoming: EditorOperation[],
): CoalesceResult {
  let result = [...existing];
  let applied = 0;
  let skipped = 0;

  for (const operation of incoming) {
    if (operation.type !== "hide") {
      result.push(operation);
      applied += 1;
      continue;
    }

    const key = operationTargetKey(operation);
    if (!key) {
      result.push(operation);
      applied += 1;
      continue;
    }

    const currentState = effectiveHideState(result, key);
    if (operation.payload.hidden && currentState === true) {
      skipped += 1;
      continue;
    }
    if (!operation.payload.hidden && currentState !== true) {
      skipped += 1;
      continue;
    }

    result = result.filter(
      (candidate) => !(candidate.type === "hide" && operationTargetKey(candidate) === key),
    );

    if (operation.payload.hidden) {
      result.push(operation);
      applied += 1;
    } else {
      // Showing removes a prior hide without storing a redundant show op.
      applied += 1;
    }
  }

  return { operations: result, applied, skipped };
}

/** @deprecated Use coalescePageOperations().operations */
export function mergePageOperations(
  existing: EditorOperation[],
  incoming: EditorOperation[],
): EditorOperation[] {
  return coalescePageOperations(existing, incoming).operations;
}
