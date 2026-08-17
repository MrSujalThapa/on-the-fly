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
import type { ElementHandle } from "./element-registry.js";
import {
  isResolvedElement,
  type ElementRegistry,
} from "./element-registry.js";
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

export interface OperationExecutorDeps {
  document: Document;
  registry: ElementRegistry;
  ledger: OperationLedger;
  placement: PlacementEngine;
}

interface CapturedEffect {
  handle: ElementHandle;
  snapshot: ElementDomSnapshot;
  originalRect: IntendedRect;
}

function failure(error: string, rolledBack: boolean, verification?: VisualVerification): ExecutionFailure {
  if (verification) {
    return { ok: false, error, rolledBack, verification };
  }
  return { ok: false, error, rolledBack };
}

function handleFromMove(operation: MoveOperation): ElementHandle | null {
  const signature = operation.target.signature;
  if (!signature) {
    return null;
  }
  return { id: operation.id, signature };
}

function toTarget(handle: ElementHandle, rect: IntendedRect): TransformTarget {
  return {
    nodeId: handle.id,
    signature: handle.signature,
    rect,
  };
}

function buildVerifiedMove(
  handle: ElementHandle,
  plan: { dx: number; dy: number; payload: MoveOperation["payload"]; expectedRect: IntendedRect },
  currentRect: IntendedRect,
  pageKey: PageKey,
): MoveOperation | ExecutionFailure {
  const drafted = buildMoveOperation(toTarget(handle, currentRect), plan.dx, plan.dy, {
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

  const resolveOrFail = (handle: ElementHandle): { element: HTMLElement } | ExecutionFailure => {
    const resolved = deps.registry.resolve(handle);
    if (!isResolvedElement(resolved)) {
      return failure(
        resolved.kind === "ambiguous" ? "ambiguous_target" : "unresolved_target",
        false,
      );
    }
    return { element: resolved.element };
  };

  const rollback = (element: HTMLElement, snapshot: ElementDomSnapshot): boolean => {
    try {
      restoreElementDomSnapshot(deps.document, snapshot, element);
      return true;
    } catch {
      return false;
    }
  };

  const verifyIdentity = (handle: ElementHandle, element: HTMLElement): boolean => {
    if (!element.isConnected) {
      return false;
    }
    const resolved = deps.registry.resolve(handle);
    return isResolvedElement(resolved) && resolved.element === element;
  };

  const applyAndVerify = (input: {
    handle: ElementHandle;
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

    if (!verifyIdentity(input.handle, input.element)) {
      const rolledBack = rollback(input.element, snapshot);
      return failure("identity_uncertain", rolledBack, verification);
    }

    deps.registry.cache(input.handle, input.element);

    if (input.captureEffect) {
      effects.set(input.operation.id, {
        handle: input.handle,
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
      const resolved = resolveOrFail(input.handle);
      if ("error" in resolved) {
        return resolved;
      }

      const currentRect = rectFromElement(resolved.element);
      const plan = deps.placement.planMove({
        handle: input.handle,
        element: resolved.element,
        currentRect,
        dx: input.dx,
        dy: input.dy,
      });
      const operation = buildVerifiedMove(input.handle, plan, currentRect, input.pageKey);
      if ("error" in operation) {
        return operation;
      }

      return applyAndVerify({
        handle: input.handle,
        element: resolved.element,
        operation,
        expected: plan.expectedRect,
        commit: true,
        captureEffect: true,
      });
    },

    replayMove(operation) {
      const handle = handleFromMove(operation);
      if (!handle) {
        return failure("missing_signature", false);
      }
      deps.registry.invalidate(handle);
      const resolved = resolveOrFail(handle);
      if ("error" in resolved) {
        return resolved;
      }

      const expected = operation.metadata?.finalRect ?? {
        x: rectFromElement(resolved.element).x + operation.payload.dx,
        y: rectFromElement(resolved.element).y + operation.payload.dy,
        width: rectFromElement(resolved.element).width,
        height: rectFromElement(resolved.element).height,
      };

      return applyAndVerify({
        handle,
        element: resolved.element,
        operation,
        expected,
        commit: false,
        captureEffect: true,
      });
    },

    revertCommitted(operation) {
      const handle = handleFromMove(operation) ?? effects.get(operation.id)?.handle;
      if (!handle) {
        return failure("missing_signature", false);
      }
      const resolved = resolveOrFail(handle);
      if ("error" in resolved) {
        return resolved;
      }

      const effect = effects.get(operation.id);
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
          handle,
          element: resolved.element,
          currentRect: current,
          dx: original.x - current.x,
          dy: original.y - current.y,
        });
        const inverse = buildVerifiedMove(handle, plan, current, operation.pageKey);
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
      if (!verifyIdentity(handle, resolved.element)) {
        return failure("identity_uncertain", false, verification);
      }
      return { ok: true, operation, verification };
    },

    reapplyCommitted(operation) {
      return this.replayMove(operation);
    },
  };
}
