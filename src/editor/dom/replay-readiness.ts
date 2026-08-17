import type { EditorOperation } from "../operations.js";
import { resolveElementBySignature } from "./element-resolver.js";

const DEFAULT_MAX_FRAMES = 120;

function operationCreatesTarget(operation: EditorOperation): boolean {
  return operation.type === "insertHelperObject" || operation.type === "duplicate";
}

export function canResolveOperationTarget(
  root: ParentNode,
  operation: EditorOperation,
): boolean {
  if (operationCreatesTarget(operation)) {
    return true;
  }

  const signature = operation.target.signature;
  if (!signature) {
    return false;
  }

  return resolveElementBySignature(root, signature) !== null;
}

export function countResolvableOperationTargets(
  root: ParentNode,
  operations: readonly EditorOperation[],
): number {
  let resolved = 0;
  for (const operation of operations) {
    if (canResolveOperationTarget(root, operation)) {
      resolved += 1;
    }
  }
  return resolved;
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

export async function waitForDocumentReady(document: Document): Promise<void> {
  if (document.readyState === "complete") {
    return;
  }

  await new Promise<void>((resolve) => {
    const finish = (): void => {
      resolve();
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", finish, { once: true });
    }

    document.defaultView?.addEventListener("load", finish, { once: true });
  });
}

/**
 * Waits until replay targets exist in the DOM (or times out). Prevents applying
 * saved operations before SPA/hydration finishes, which previously required
 * multiple refreshes before the page looked correct.
 */
export async function waitForReplayTargets(
  root: ParentNode,
  operations: readonly EditorOperation[],
  options: { maxFrames?: number } = {},
): Promise<{ resolved: number; total: number; timedOut: boolean }> {
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
  const total = operations.length;

  if (total === 0) {
    return { resolved: 0, total: 0, timedOut: false };
  }

  let resolved = countResolvableOperationTargets(root, operations);
  if (resolved === total) {
    return { resolved, total, timedOut: false };
  }

  for (let frame = 0; frame < maxFrames; frame += 1) {
    await waitForNextFrame();
    resolved = countResolvableOperationTargets(root, operations);
    if (resolved === total) {
      return { resolved, total, timedOut: false };
    }
  }

  return { resolved, total, timedOut: true };
}
