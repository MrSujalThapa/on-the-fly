import type { EditorOperation, MoveOperation, ZIndexOperation } from "../editor/operations.js";
import { freezeCommittedOperation } from "./freeze-operation.js";
import { identifyingContent, isGeneratedIdentityValue } from "./visual-identity.js";

export type CanonicalCheckpoint =
  | { readonly ok: true; readonly operations: EditorOperation[] }
  | { readonly ok: false; readonly error: string };

function isMoveOperation(value: EditorOperation): value is MoveOperation {
  return value.type === "move";
}

function isLayerOperation(value: EditorOperation): value is ZIndexOperation {
  return value.type === "zIndex";
}

/**
 * Durable MOVE key. Session VisualNodeId is not identity. CSS path is a locator,
 * not a key, so similar siblings compact and resolve independently.
 */
export function durableMoveKey(operation: MoveOperation | ZIndexOperation): string | null {
  const signature = operation.target.signature;
  if (!signature) {
    return null;
  }
  if (signature.idAttr && !isGeneratedIdentityValue(signature.idAttr)) {
    return `id:${signature.idAttr}`;
  }
  if (signature.hrefAttr) {
    return `href:${signature.tagName}:${signature.hrefAttr}`;
  }
  if (signature.nameAttr) {
    return `name:${signature.tagName}:${signature.nameAttr}`;
  }
  if (signature.datasetFingerprint) {
    const stable = signature.datasetFingerprint
      .split(";")
      .filter((part) => {
        const value = part.split("=")[1] ?? "";
        return !isGeneratedIdentityValue(value);
      })
      .join(";");
    if (stable) {
      return `data:${stable}`;
    }
  }
  const aria = identifyingContent(signature.ariaLabel);
  const content = identifyingContent(signature.textFingerprint);
  const semantic = aria || content;
  if (semantic) {
    const parent = signature.parentFingerprint ?? "";
    const role = signature.role ?? "";
    return `el:${signature.tagName}|${role}|${parent}|${semantic}`;
  }
  const parent = signature.parentFingerprint ?? "";
  const classes = [...signature.classList].slice(0, 3).join(".");
  if (!parent && classes.length === 0) {
    return null;
  }
  return `el:${signature.tagName}|${classes}|${parent}|`;
}

function continuityKey(operation: MoveOperation): string {
  const signature = operation.target.signature;
  if (!signature) {
    return "missing";
  }
  if (signature.siblingOrdinal !== undefined && signature.siblingCount !== undefined) {
    return `sibling:${String(signature.siblingOrdinal)}/${String(signature.siblingCount)}`;
  }
  return `path:${signature.cssPath.replace(/#ember\d+/giu, "#<generated>")}`;
}

function composeMove(group: MoveOperation[]): MoveOperation {
  const first = group[0];
  const last = group[group.length - 1];
  if (!first || !last) {
    throw new Error("empty_move_group");
  }
  const original = first.metadata?.originalRect ?? last.metadata?.originalRect;
  const finalRect = last.metadata?.finalRect ?? last.metadata?.affectedRect;
  // MOVE payloads are target-local deltas. Geometry may also include movement
  // inherited from an edited ancestor, so finalRect - originalRect would
  // double-apply that ancestor displacement during replay.
  const dx = group.reduce((sum, operation) => sum + operation.payload.dx, 0);
  const dy = group.reduce((sum, operation) => sum + operation.payload.dy, 0);
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
    // The first operation owns the host-page identity snapshot. Later MOVE
    // operations may follow an OTF-managed reparent/detach and must not replace
    // that identity with a locator derived from OTF-mutated DOM.
    target: first.target,
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
  const sessionKeys = new Map<string, string>();
  const checkpointKey = (operation: MoveOperation | ZIndexOperation): string | null => {
    const durable = durableMoveKey(operation);
    if (!durable) return null;
    const nodeId = operation.target.nodeId;
    if (!nodeId) return durable;
    const adopted = sessionKeys.get(nodeId);
    if (adopted) return adopted;
    sessionKeys.set(nodeId, durable);
    return durable;
  };
  const moves = new Map<string, { continuity: string; operations: MoveOperation[] }>();
  const layers = new Map<string, ZIndexOperation>();
  const rest: EditorOperation[] = [];

  for (const operation of operations) {
    if (isLayerOperation(operation)) {
      const key = checkpointKey(operation);
      if (!key) {
        return { ok: false, error: "layer_missing_durable_identity" };
      }
      layers.set(key, operation);
      continue;
    }
    if (!isMoveOperation(operation)) {
      rest.push(operation);
      continue;
    }
    const key = checkpointKey(operation);
    if (!key) {
      return { ok: false, error: "move_missing_durable_identity" };
    }
    const continuity = continuityKey(operation);
    const group = moves.get(key);
    const sameAdoptedNode = Boolean(
      group && operation.target.nodeId && group.operations.some(
        (candidate) => candidate.target.nodeId === operation.target.nodeId,
      ),
    );
    if (group && group.continuity !== continuity && !sameAdoptedNode) {
      return { ok: false, error: "move_durable_identity_collision" };
    }
    if (group) {
      group.operations.push(operation);
    } else {
      moves.set(key, { continuity, operations: [operation] });
    }
  }

  const canonicalMoves = [...moves.values()]
    .map((group) => composeMove(group.operations))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return {
    ok: true,
    operations: [...rest, ...canonicalMoves, ...layers.values()],
  };
}
