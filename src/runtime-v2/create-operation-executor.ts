import type { MoveOperation } from "../editor/operations.js";
import type { PageKey } from "../editor/ids.js";
import { validateOperation } from "../editor/validation/validate-operation.js";
import { applyMoveOperation } from "../editor/dom/handlers/transform-handler.js";
import { ElementSnapshotStore } from "../editor/dom/element-snapshot.js";
import {
  captureElementDomSnapshot,
  restoreElementDomSnapshot,
  type ElementDomSnapshot,
} from "../editor/dom/dom-placement-snapshot.js";
import { buildMoveOperation } from "../editor/transform/operation-factory.js";
import type { TransformTarget } from "../editor/transform/transform-target.js";
import type { VisualNodeId } from "../editor/ids.js";
import { freezeCommittedOperation } from "./freeze-operation.js";
import { rectFromElement, rectsNear } from "./geometry.js";
import type { OperationLedger } from "./operation-ledger.js";
import type {
  ExecutionFailure,
  ExecutionResult,
  OperationExecutor,
  VisualVerification,
} from "./operation-executor.js";
import type { IntendedRect, PlacementEngine } from "./placement-engine.js";
import type { DurableVisualIdentity, VisualModel } from "./visual-model.js";
import { isResolvedVisual } from "./visual-model.js";

export interface OperationExecutorDeps {
  document: Document;
  visualModel: VisualModel;
  ledger: OperationLedger;
  placement: PlacementEngine;
}

interface CapturedEffect {
  nodeId: VisualNodeId;
  snapshot: ElementDomSnapshot;
  originalRect: IntendedRect;
}

function failure(error: string, rolledBack: boolean, verification?: VisualVerification): ExecutionFailure {
  if (verification) {
    return { ok: false, error, rolledBack, verification };
  }
  return { ok: false, error, rolledBack };
}

/** Persistence-boundary compatibility reader. Does not live in VisualModel. */
export function identityFromMove(operation: MoveOperation): DurableVisualIdentity | null {
  const signature = operation.target.signature;
  if (!signature) {
    return null;
  }
  return { signature };
}

function toTarget(nodeId: VisualNodeId, identity: DurableVisualIdentity, rect: IntendedRect): TransformTarget {
  return {
    nodeId,
    signature: identity.signature,
    rect,
  };
}

function buildVerifiedMove(
  nodeId: VisualNodeId,
  identity: DurableVisualIdentity,
  plan: { dx: number; dy: number; payload: MoveOperation["payload"]; expectedRect: IntendedRect },
  currentRect: IntendedRect,
  pageKey: PageKey,
): MoveOperation | ExecutionFailure {
  const drafted = buildMoveOperation(toTarget(nodeId, identity, currentRect), plan.dx, plan.dy, {
    pageKey,
    sourceCommand: "move",
  });
  const operation: MoveOperation = {
    ...drafted,
    status: "approved",
    payload: {
      ...drafted.payload,
      ...plan.payload,
    },
    metadata: {
      ...drafted.metadata,
      originalRect: currentRect,
      finalRect: plan.expectedRect,
      affectedRect: plan.expectedRect,
    },
  };
  const validation = validateOperation(operation);
  if (!validation.ok) {
    return failure(validation.errors.join("; ") || "invalid_operation", false);
  }
  return freezeCommittedOperation(operation);
}

export function createOperationExecutor(deps: OperationExecutorDeps): OperationExecutor {
  const snapshotStore = new ElementSnapshotStore();
  const effects = new Map<string, CapturedEffect>();

  const resolveOrFail = (
    nodeId: VisualNodeId | null,
    identity: DurableVisualIdentity,
  ): { nodeId: VisualNodeId | null; element: HTMLElement } | ExecutionFailure => {
    const resolved = nodeId
      ? deps.visualModel.resolveNode(nodeId)
      : deps.visualModel.resolveIdentity(identity);
    if (!isResolvedVisual(resolved)) {
      return failure(
        resolved.kind === "ambiguous" ? "ambiguous_target" : "unresolved_target",
        false,
      );
    }
    return { nodeId: resolved.nodeId, element: resolved.element };
  };

  const rollback = (element: HTMLElement, snapshot: ElementDomSnapshot): boolean => {
    try {
      restoreElementDomSnapshot(deps.document, snapshot, element);
      return true;
    } catch {
      return false;
    }
  };

  const verifyIdentity = (nodeId: VisualNodeId | null, identity: DurableVisualIdentity, element: HTMLElement): boolean => {
    if (!element.isConnected) {
      return false;
    }
    const resolved = nodeId
      ? deps.visualModel.resolveNode(nodeId)
      : deps.visualModel.resolveIdentity(identity);
    return isResolvedVisual(resolved) && resolved.element === element;
  };

  const applyAndVerify = (input: {
    nodeId: VisualNodeId | null;
    identity: DurableVisualIdentity;
    element: HTMLElement;
    operation: MoveOperation;
    expected: IntendedRect;
    commit: boolean;
    captureEffect: boolean;
  }): ExecutionResult => {
    const snapshot = captureElementDomSnapshot(input.element, deps.document);
    const originalRect = rectFromElement(input.element);

    try {
      applyMoveOperation(input.element, input.operation, snapshotStore);
    } catch (error) {
      const rolledBack = rollback(input.element, snapshot);
      return failure(error instanceof Error ? error.message : "apply_threw", rolledBack);
    }

    const actual = rectFromElement(input.element);
    const verification: VisualVerification = {
      ok: rectsNear(actual, input.expected),
      expected: input.expected,
      actual,
    };

    if (!verification.ok) {
      const rolledBack = rollback(input.element, snapshot);
      return failure("geometry_mismatch", rolledBack, verification);
    }

    if (!verifyIdentity(input.nodeId, input.identity, input.element)) {
      const rolledBack = rollback(input.element, snapshot);
      return failure("identity_uncertain", rolledBack, verification);
    }

    if (input.nodeId) {
      deps.visualModel.cache(input.nodeId, input.element);
    }

    if (input.captureEffect && input.nodeId) {
      effects.set(input.operation.id, {
        nodeId: input.nodeId,
        snapshot,
        originalRect,
      });
    }

    if (input.commit) {
      deps.ledger.commit(input.operation);
    }

    return { ok: true, operation: input.operation, verification };
  };

  return {
    executeMove(input) {
      const identity = deps.visualModel.durableIdentityOf(input.nodeId);
      if (!identity) {
        return failure("missing_identity", false);
      }
      const resolved = resolveOrFail(input.nodeId, identity);
      if ("error" in resolved) {
        return resolved;
      }

      const currentRect = rectFromElement(resolved.element);
      const plan = deps.placement.planMove({
        element: resolved.element,
        currentRect,
        dx: input.dx,
        dy: input.dy,
      });
      const operation = buildVerifiedMove(input.nodeId, identity, plan, currentRect, input.pageKey);
      if ("error" in operation) {
        return operation;
      }

      return applyAndVerify({
        nodeId: input.nodeId,
        identity,
        element: resolved.element,
        operation,
        expected: plan.expectedRect,
        commit: true,
        captureEffect: true,
      });
    },

    replayMove(operation) {
      const identity = identityFromMove(operation);
      if (!identity) {
        return failure("missing_signature", false);
      }
      if (operation.target.nodeId) {
        deps.visualModel.invalidate(operation.target.nodeId);
      }
      const resolved = resolveOrFail(null, identity);
      if ("error" in resolved) {
        return resolved;
      }

      const current = rectFromElement(resolved.element);
      const composed = {
        x: current.x + operation.payload.dx,
        y: current.y + operation.payload.dy,
        width: current.width,
        height: current.height,
      };
      const stored = operation.metadata?.finalRect;
      const expected = stored && rectsNear(composed, stored, 24) ? stored : composed;
      const replayOperation: MoveOperation =
        expected === stored
          ? operation
          : {
              ...operation,
              metadata: {
                ...operation.metadata,
                finalRect: expected,
                affectedRect: expected,
              },
            };

      return applyAndVerify({
        nodeId: resolved.nodeId,
        identity,
        element: resolved.element,
        operation: replayOperation,
        expected,
        commit: false,
        captureEffect: true,
      });
    },

    revertCommitted(operation) {
      const identity = identityFromMove(operation);
      const effect = effects.get(operation.id);
      if (!identity) {
        return failure("missing_signature", false);
      }
      const resolved = resolveOrFail(effect?.nodeId ?? null, identity);
      if ("error" in resolved) {
        return resolved;
      }

      const original = effect?.originalRect ?? operation.metadata?.originalRect;
      if (!original) {
        return failure("missing_original_rect", false);
      }

      if (effect) {
        const rolledBack = rollback(resolved.element, effect.snapshot);
        if (!rolledBack) {
          return failure("rollback_failed", false);
        }
      } else {
        const current = rectFromElement(resolved.element);
        const plan = deps.placement.planMove({
          element: resolved.element,
          currentRect: current,
          dx: original.x - current.x,
          dy: original.y - current.y,
        });
        const inverse = buildVerifiedMove(
          resolved.nodeId ?? operation.id,
          identity,
          plan,
          current,
          operation.pageKey,
        );
        if ("error" in inverse) {
          return inverse;
        }
        try {
          applyMoveOperation(resolved.element, inverse, snapshotStore);
        } catch (error) {
          return failure(error instanceof Error ? error.message : "revert_threw", false);
        }
      }

      const actual = rectFromElement(resolved.element);
      const verification: VisualVerification = {
        ok: rectsNear(actual, original),
        expected: original,
        actual,
      };
      if (!verification.ok) {
        return failure("undo_geometry_mismatch", false, verification);
      }
      if (!verifyIdentity(resolved.nodeId, identity, resolved.element)) {
        return failure("identity_uncertain", false, verification);
      }
      return { ok: true, operation, verification };
    },

    reapplyCommitted(operation) {
      return this.replayMove(operation);
    },
  };
}
