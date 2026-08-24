import type { CropOperation, DuplicateOperation, EditorOperation, HideOperation, MoveOperation, ResizeOperation, RotateOperation, StyleOperation, TextOperation, ZIndexOperation } from "../editor/operations.js";
import { freezeCommittedOperation } from "./freeze-operation.js";
import { identifyingContent, isGeneratedIdentityValue } from "./visual-identity.js";
import { validateOperation } from "../editor/validation/validate-operation.js";

export type CanonicalCheckpoint =
  | { readonly ok: true; readonly operations: EditorOperation[] }
  | { readonly ok: false; readonly error: string };

const CLONE_DATA_PREFIX = "otfCloneId=";

function cloneIdFromOperation(operation: EditorOperation): string | null {
  if (operation.type === "duplicate") return operation.payload.cloneId;
  const signature = operation.target.signature;
  const dataset = signature?.datasetFingerprint;
  if (dataset?.startsWith(CLONE_DATA_PREFIX)) return dataset.slice(CLONE_DATA_PREFIX.length) || null;
  const cssMatch = /\[data-otf-clone-id=["']([^"']+)["']\]/u.exec(signature?.cssPath ?? "");
  return cssMatch?.[1] ?? null;
}

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

function composeFinalState<T extends ResizeOperation | RotateOperation | HideOperation>(first: T, last: T): T {
  const originalRect = first.metadata?.originalRect ?? last.metadata?.originalRect;
  const finalRect = last.metadata?.finalRect ?? last.metadata?.affectedRect;
  return freezeCommittedOperation({
    ...last,
    target: first.target,
    metadata: {
      ...last.metadata,
      ...(originalRect ? { originalRect } : {}),
      ...(finalRect ? { finalRect, affectedRect: finalRect } : {}),
    },
  });
}

function composeStyle(first: StyleOperation, last: StyleOperation): StyleOperation {
  const payload: StyleOperation["payload"] = first.payload.previousValue === undefined
    ? { property: last.payload.property, value: last.payload.value, ...(last.payload.scope ? { scope: last.payload.scope } : {}) }
    : { property: last.payload.property, value: last.payload.value, previousValue: first.payload.previousValue, ...(last.payload.scope ? { scope: last.payload.scope } : {}) };
  const composed: StyleOperation = { ...last, target: first.target, payload };
  return freezeCommittedOperation(composed);
}

function composeText(first: TextOperation, last: TextOperation): TextOperation {
  const payload: TextOperation["payload"] = first.payload.previousValue === undefined
    ? { value: last.payload.value, preserveFormat: true }
    : { value: last.payload.value, preserveFormat: true, previousValue: first.payload.previousValue };
  const composed: TextOperation = { ...last, target: first.target, payload };
  return freezeCommittedOperation(composed);
}

function composeCrop(first: CropOperation, last: CropOperation): CropOperation {
  return freezeCommittedOperation({ ...last, target: first.target });
}

/**
 * Session history stays on the ledger. Persistence stores this canonical
 * projection: one final MOVE per durable target.
 */
export function projectCanonicalCheckpoint(
  operations: readonly EditorOperation[],
): CanonicalCheckpoint {
  const duplicates = new Map<string, DuplicateOperation>();
  for (const operation of operations) {
    if (operation.status !== "approved") return { ok: false, error: `invalid_operation_status:${operation.id}:${operation.status}` };
    if (operation.type !== "duplicate") continue;
    const cloneId = operation.payload.cloneId;
    if (duplicates.has(cloneId)) return { ok: false, error: `duplicate_clone_creation:${cloneId}` };
    if (operation.target.nodeId !== cloneId) return { ok: false, error: `clone_creation_target_mismatch:${cloneId}` };
    duplicates.set(cloneId, operation);
  }
  const sessionKeys = new Map<string, string>();
  const checkpointKey = (operation: EditorOperation): string | null => {
    const cloneId = cloneIdFromOperation(operation);
    if (cloneId) return duplicates.has(cloneId) ? `clone:${cloneId}` : null;
    const durable = durableMoveKey(operation as MoveOperation);
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
  const resizes = new Map<string, ResizeOperation>();
  const rotates = new Map<string, RotateOperation>();
  const hides = new Map<string, HideOperation>();
  const crops = new Map<string, CropOperation>();
  const texts = new Map<string, TextOperation>();
  const styles = new Map<string, StyleOperation>();
  const rest: EditorOperation[] = [];

  for (const operation of operations) {
    if (operation.type === "duplicate") {
      continue;
    }
    const referencedClone = cloneIdFromOperation(operation);
    if (referencedClone && !duplicates.has(referencedClone)) {
      return { ok: false, error: `clone_effect_missing_creation:${referencedClone}:${operation.id}:${operation.type}:${operation.target.nodeId ?? "missing"}:known=${[...duplicates.keys()].sort().join(",") || "none"}` };
    }
    if (operation.type === "resize" || operation.type === "rotate" || operation.type === "hide") {
      const key = checkpointKey(operation);
      if (!key) return { ok: false, error: `${operation.type}_missing_durable_identity` };
      if (operation.type === "resize") {
        const first = resizes.get(key);
        resizes.set(key, first ? composeFinalState(first, operation) : operation);
      } else if (operation.type === "rotate") {
        const first = rotates.get(key);
        rotates.set(key, first ? composeFinalState(first, operation) : operation);
      } else {
        const first = hides.get(key);
        hides.set(key, first ? composeFinalState(first, operation) : operation);
      }
      continue;
    }
    if (operation.type === "crop" || operation.type === "text" || operation.type === "style") {
      const entityKey = checkpointKey(operation);
      if (!entityKey) return { ok: false, error: `${operation.type}_missing_durable_identity` };
      if (operation.type === "style") {
        const key = `${entityKey}|style:${operation.payload.property}`;
        const first = styles.get(key);
        styles.set(key, first ? composeStyle(first, operation) : operation);
      } else if (operation.type === "text") {
        const first = texts.get(entityKey);
        texts.set(entityKey, first ? composeText(first, operation) : operation);
      } else {
        const first = crops.get(entityKey);
        crops.set(entityKey, first ? composeCrop(first, operation) : operation);
      }
      continue;
    }
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
      const priorNodeIds = [...new Set(group.operations.map((candidate) => candidate.target.nodeId ?? "missing"))].join(",");
      return { ok: false, error: `move_durable_identity_collision:${key}:${group.continuity}:${continuity}:${priorNodeIds}:${operation.target.nodeId ?? "missing"}` };
    }
    if (group) {
      group.operations.push(operation);
    } else {
      moves.set(key, { continuity, operations: [operation] });
    }
  }

  const canonicalMovesByKey = new Map(
    [...moves.entries()].map(([key, group]) => [key, composeMove(group.operations)] as const),
  );
  for (const [key, move] of canonicalMovesByKey) {
    const rotation = rotates.get(key);
    const visualRect = move.metadata?.finalRect;
    if (!rotation || !visualRect || rotation.payload.degrees === 0) continue;
    const resize = resizes.get(key);
    const rotationOrigin = rotation.metadata?.originalRect;
    const localWidth = resize?.payload.width ?? move.payload.detachedWidth ?? rotationOrigin?.width;
    const localHeight = resize?.payload.height ?? move.payload.detachedHeight ?? rotationOrigin?.height;
    if (!localWidth || !localHeight) continue;
    const finalRect = {
      x: visualRect.x + (visualRect.width - localWidth) / 2,
      y: visualRect.y + (visualRect.height - localHeight) / 2,
      width: localWidth,
      height: localHeight,
    };
    const scrollX = move.payload.detachedLeft === undefined ? 0 : move.payload.detachedLeft - visualRect.x;
    const scrollY = move.payload.detachedTop === undefined ? 0 : move.payload.detachedTop - visualRect.y;
    canonicalMovesByKey.set(key, freezeCommittedOperation({
      ...move,
      payload: {
        ...move.payload,
        ...(move.payload.detachedLeft === undefined ? {} : { detachedLeft: finalRect.x + scrollX }),
        ...(move.payload.detachedTop === undefined ? {} : { detachedTop: finalRect.y + scrollY }),
        ...(move.payload.detached ? { detachedWidth: localWidth, detachedHeight: localHeight } : {}),
      },
      metadata: { ...move.metadata, finalRect, affectedRect: finalRect },
    }));
  }
  const sortEntries = <T>(entries: Iterable<readonly [string, T]>): T[] =>
    [...entries].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
  const canonicalMoves = sortEntries(canonicalMovesByKey.entries());
  const canonicalResizes = [...resizes.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, resize]) => {
    const placementRect = canonicalMovesByKey.get(key)?.metadata?.finalRect;
    const sizeRect = resize.metadata?.finalRect ?? resize.metadata?.affectedRect;
    if (!placementRect || !sizeRect) return resize;
    const finalRect = {
      x: placementRect.x,
      y: placementRect.y,
      width: sizeRect.width,
      height: sizeRect.height,
    };
    return freezeCommittedOperation({
      ...resize,
      metadata: { ...resize.metadata, finalRect, affectedRect: finalRect },
    });
  });
  const projected = [
      ...sortEntries(duplicates.entries()),
      ...rest.slice().sort((a, b) => a.type.localeCompare(b.type) || (a.target.nodeId ?? "").localeCompare(b.target.nodeId ?? "") || a.id.localeCompare(b.id)),
      ...canonicalMoves,
      ...canonicalResizes,
      ...sortEntries(rotates.entries()),
      ...sortEntries(crops.entries()),
      ...sortEntries(styles.entries()),
      ...sortEntries(texts.entries()),
      ...sortEntries(layers.entries()),
      ...sortEntries(hides.entries()),
    ];
  for (const operation of projected) {
    const validation = validateOperation(operation);
    if (!validation.ok) return { ok: false, error: `invalid_checkpoint_operation:${operation.id}:${validation.errors.join("|")}` };
  }
  return { ok: true, operations: projected };
}
