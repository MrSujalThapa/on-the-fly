import type { EditorOperation, MoveOperation } from "../editor/operations.js";
import { freezeCommittedOperation } from "./freeze-operation.js";
import { identifyingContent } from "./visual-identity.js";

export type CanonicalCheckpoint =
  | { readonly ok: true; readonly operations: EditorOperation[] }
  | { readonly ok: false; readonly error: string };

function isMoveOperation(value: EditorOperation): value is MoveOperation {
  return value.type === "move";
}

/**
 * Durable MOVE key. Session VisualNodeId is not identity. CSS path is a locator,
 * not a key, so similar siblings compact and resolve independently.
 */
export function durableMoveKey(operation: MoveOperation): string | null {
  const signature = operation.target.signature;
  if (!signature) {
    return null;
  }
  if (signature.idAttr) {
    return `id:${signature.idAttr}`;
  }
  if (signature.datasetFingerprint) {
    return `data:${signature.datasetFingerprint}`;
  }
  if (signature.hrefAttr) {
    return `href:${signature.tagName}:${signature.hrefAttr}`;
  }
  if (signature.nameAttr) {
    return `name:${signature.tagName}:${signature.nameAttr}`;
  }
  const content = identifyingContent(signature.textFingerprint);
  const parent = signature.parentFingerprint ?? "";
  const classes = [...signature.classList].slice(0, 3).join(".");
  if (!content && !parent && classes.length === 0) {
    return null;
  }
  return `el:${signature.tagName}|${classes}|${parent}|${content}`;
}

function composeMove(group: MoveOperation[]): MoveOperation {
  const first = group[0];
  const last = group[group.length - 1];
  if (!first || !last) {
    throw new Error("empty_move_group");
  }
  const original = first.metadata?.originalRect ?? last.metadata?.originalRect;
  const finalRect = last.metadata?.finalRect ?? last.metadata?.affectedRect;
  const dx =
    original && finalRect ? finalRect.x - original.x : group.reduce((sum, operation) => sum + operation.payload.dx, 0);
  const dy =
    original && finalRect ? finalRect.y - original.y : group.reduce((sum, operation) => sum + operation.payload.dy, 0);
  const metadata: MoveOperation["metadata"] = {};
  if (last.metadata?.targetSummary) {
    metadata.targetSummary = last.metadata.targetSummary;
  }
  if (last.metadata?.sourceCommand) {
    metadata.sourceCommand = last.metadata.sourceCommand;
  }
  if (original) {
    metadata.originalRect = original;
  }
  if (finalRect) {
    metadata.finalRect = finalRect;
    metadata.affectedRect = finalRect;
  }
  const composed: MoveOperation = {
    ...last,
    type: "move",
    payload: {
      ...last.payload,
      dx,
      dy,
      previousDx: 0,
      previousDy: 0,
    },
    metadata,
  };
  return freezeCommittedOperation(composed);
}

/**
 * Session history stays on the ledger. Persistence stores this canonical
 * projection: one final MOVE per durable target.
 */
export function projectCanonicalCheckpoint(
  operations: readonly EditorOperation[],
): CanonicalCheckpoint {
  const moves = new Map<string, MoveOperation[]>();
  const rest: EditorOperation[] = [];

  for (const operation of operations) {
    if (!isMoveOperation(operation)) {
      rest.push(operation);
      continue;
    }
    const key = durableMoveKey(operation);
    if (!key) {
      return { ok: false, error: "move_missing_durable_identity" };
    }
    const group = moves.get(key) ?? [];
    group.push(operation);
    moves.set(key, group);
  }

  const canonicalMoves = [...moves.values()].map(composeMove);
  return {
    ok: true,
    operations: [...rest, ...canonicalMoves],
  };
}
