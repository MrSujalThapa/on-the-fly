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

/** Removes z-index operations that target the same element keys. */
export function stripZIndexOperationsForTargetKeys(
  operations: EditorOperation[],
  targetKeys: ReadonlySet<string>,
): EditorOperation[] {
  if (targetKeys.size === 0) {
    return operations;
  }

  return operations.filter((operation) => {
    if (operation.type !== "zIndex") {
      return true;
    }

    const key = operationTargetKey(operation);
    return !key || !targetKeys.has(key);
  });
}

export function keepLatestZIndexOperations(operations: EditorOperation[]): EditorOperation[] {
  const lastIndexByTarget = new Map<string, number>();

  operations.forEach((operation, index) => {
    if (operation.type !== "zIndex") {
      return;
    }
    const key = operationTargetKey(operation);
    if (key) {
      lastIndexByTarget.set(key, index);
    }
  });

  if (lastIndexByTarget.size === 0) {
    return operations;
  }

  return operations.filter((operation, index) => {
    if (operation.type !== "zIndex") {
      return true;
    }
    const key = operationTargetKey(operation);
    if (!key) {
      return true;
    }
    return lastIndexByTarget.get(key) === index;
  });
}

export function zIndexTargetKeys(operations: readonly EditorOperation[]): Set<string> {
  const keys = new Set<string>();
  for (const operation of operations) {
    if (operation.type !== "zIndex") {
      continue;
    }
    const key = operationTargetKey(operation);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * Merges incoming operations into the existing page list. Hide ops for the same
 * target collapse to a single final hide record; repeated hide or redundant
 * show ops are dropped. z-index ops for the same target keep only the latest
 * record so replay always reflects the final layer order.
 */
export function coalescePageOperations(
  existing: EditorOperation[],
  incoming: EditorOperation[],
): CoalesceResult {
  let result = [...existing];
  let applied = 0;
  let skipped = 0;

  for (const operation of incoming) {
    if (operation.type === "zIndex") {
      const key = operationTargetKey(operation);
      if (key) {
        result = result.filter(
          (candidate) => !(candidate.type === "zIndex" && operationTargetKey(candidate) === key),
        );
      }
      result.push(operation);
      applied += 1;
      continue;
    }

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
