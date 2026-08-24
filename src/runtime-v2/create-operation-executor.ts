import type { MoveOperation, ZIndexOperation } from "../editor/operations.js";
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
  BatchExecutionResult,
  ExecutionFailure,
  ExecutionResult,
  OperationExecutor,
  VisualVerification,
} from "./operation-executor.js";
import type { IntendedRect, PlacementEngine } from "./placement-engine.js";
import type { DurableVisualIdentity, VisualModel } from "./visual-model.js";
import { isResolvedVisual } from "./visual-model.js";
import { buildZIndexOperation } from "../editor/transform/operation-factory.js";
import {
  applyLayerToHost,
  inferLayerCommandFromOperation,
  resolveLayerPlan,
} from "../editor/dom/layer-overlap-resolver.js";

export interface OperationExecutorDeps {
  document: Document;
  visualModel: VisualModel;
  ledger: OperationLedger;
  placement: PlacementEngine;
}

function debugLayer(message: string, data?: unknown): void {
  if (typeof __OTF_DIAGNOSTICS_ENABLED__ !== "undefined" && __OTF_DIAGNOSTICS_ENABLED__) {
    console.info(`[otf-v2] ${message}`, data ?? {});
  }
}

interface CapturedEffect {
  nodeId: VisualNodeId;
  snapshot: ElementDomSnapshot;
  originalRect: IntendedRect;
}

interface PreparedMove {
  nodeId: VisualNodeId;
  identity: DurableVisualIdentity;
  element: HTMLElement;
  snapshot: ElementDomSnapshot;
  originalRect: IntendedRect;
  operation: MoveOperation;
  expected: IntendedRect;
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
  const layerEffects = new Map<string, { element: HTMLElement; snapshot: ElementDomSnapshot }>();

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
    const rollbackApplied = (): boolean => {
      return rollback(input.element, snapshot);
    };

    try {
      applyMoveOperation(input.element, input.operation, snapshotStore);
    } catch (error) {
      const rolledBack = rollbackApplied();
      return failure(error instanceof Error ? error.message : "apply_threw", rolledBack);
    }

    const actual = rectFromElement(input.element);
    const verification: VisualVerification = {
      ok: rectsNear(actual, input.expected),
      expected: input.expected,
      actual,
    };

    if (!verification.ok) {
      const rolledBack = rollbackApplied();
      return failure("geometry_mismatch", rolledBack, verification);
    }

    if (!verifyIdentity(input.nodeId, input.identity, input.element)) {
      const rolledBack = rollbackApplied();
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

    executeMoveBatch(input): BatchExecutionResult {
      const uniqueIds = Array.from(new Set(input.nodeIds));
      if (uniqueIds.length === 0) return failure("empty_batch", false);
      const prepared: PreparedMove[] = [];

      for (const nodeId of uniqueIds) {
        const identity = deps.visualModel.durableIdentityOf(nodeId);
        if (!identity) return failure("missing_identity", false);
        const resolved = resolveOrFail(nodeId, identity);
        if ("error" in resolved) return resolved;
        const currentRect = rectFromElement(resolved.element);
        const plan = deps.placement.planMove({
          element: resolved.element,
          currentRect,
          dx: input.dx,
          dy: input.dy,
        });
        const operation = buildVerifiedMove(nodeId, identity, plan, currentRect, input.pageKey);
        if ("error" in operation) return operation;
        prepared.push({
          nodeId,
          identity,
          element: resolved.element,
          snapshot: captureElementDomSnapshot(resolved.element, deps.document),
          originalRect: currentRect,
          operation,
          expected: plan.expectedRect,
        });
      }

      const rollbackBatch = (): boolean => {
        let ok = true;
        for (const item of [...prepared].reverse()) {
          ok = rollback(item.element, item.snapshot) && ok;
        }
        return ok;
      };

      try {
        for (const item of prepared) applyMoveOperation(item.element, item.operation, snapshotStore);
      } catch (error) {
        return failure(error instanceof Error ? error.message : "apply_threw", rollbackBatch());
      }

      const verifications: VisualVerification[] = [];
      for (const item of prepared) {
        const actual = rectFromElement(item.element);
        const verification = { ok: rectsNear(actual, item.expected), expected: item.expected, actual };
        verifications.push(verification);
        if (!verification.ok) return failure("geometry_mismatch", rollbackBatch(), verification);
        if (!verifyIdentity(item.nodeId, item.identity, item.element)) {
          return failure("identity_uncertain", rollbackBatch(), verification);
        }
      }

      for (const item of prepared) {
        deps.visualModel.cache(item.nodeId, item.element);
        effects.set(item.operation.id, {
          nodeId: item.nodeId,
          snapshot: item.snapshot,
          originalRect: item.originalRect,
        });
      }
      const operations = prepared.map((item) => item.operation);
      deps.ledger.commitBatch(operations);
      return { ok: true, operations, verifications };
    },

    executeLayer(input) {
      const identity = deps.visualModel.durableIdentityOf(input.nodeId);
      if (!identity) {
        return failure("missing_identity", false);
      }
      const resolved = resolveOrFail(input.nodeId, identity);
      if ("error" in resolved) {
        return resolved;
      }
      if (resolved.element.getAttribute("data-otf-detached") !== "true") {
        const currentRect = rectFromElement(resolved.element);
        const independentPlan = deps.placement.planMove({
          element: resolved.element,
          currentRect,
          dx: 0,
          dy: 0,
          forceIndependent: true,
        });
        const independentOperation = buildVerifiedMove(
          input.nodeId,
          identity,
          independentPlan,
          currentRect,
          input.pageKey,
        );
        if ("error" in independentOperation) {
          return independentOperation;
        }
        const independentResult = applyAndVerify({
          nodeId: input.nodeId,
          identity,
          element: resolved.element,
          operation: independentOperation,
          expected: currentRect,
          commit: true,
          captureEffect: true,
        });
        if (!independentResult.ok) {
          return independentResult;
        }
      }
      const plan = resolveLayerPlan(resolved.element, input.command, snapshotStore, { onDebug: debugLayer });
      if (plan.verification !== "pass") {
        return failure(plan.reason ?? "layer_verification_failed", false);
      }
      const snapshot = captureElementDomSnapshot(plan.host, deps.document);
      const drafted = buildZIndexOperation(
        toTarget(input.nodeId, identity, rectFromElement(resolved.element)),
        plan.layer,
        plan.previousLayer,
        { pageKey: input.pageKey, sourceCommand: `layer:${input.command}` },
        resolved.element,
      );
      const operation: ZIndexOperation = {
        ...drafted,
        target: { nodeId: input.nodeId, signature: identity.signature },
        status: "approved",
      };
      const validation = validateOperation(operation);
      if (!validation.ok) {
        return failure(validation.errors.join("; ") || "invalid_operation", false);
      }
      applyLayerToHost(plan.host, plan.layer, snapshotStore);
      const verified = resolveLayerPlan(resolved.element, input.command, snapshotStore, {
        explicitLayer: plan.layer,
      });
      if (verified.verification !== "pass" || !verifyIdentity(input.nodeId, identity, resolved.element)) {
        return failure("layer_verification_failed", rollback(plan.host, snapshot));
      }
      layerEffects.set(operation.id, { element: plan.host, snapshot });
      deps.ledger.commit(operation);
      const box = rectFromElement(resolved.element);
      return { ok: true, operation, verification: { ok: true, expected: box, actual: box } };
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
      const expected = stored && operation.payload.detached
        ? stored
        : stored && rectsNear(composed, stored, 24)
          ? { x: stored.x, y: stored.y, width: current.width, height: current.height }
          : composed;
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

    replayLayer(operation) {
      const existingEffect = layerEffects.get(operation.id);
      if (
        existingEffect?.element.isConnected &&
        existingEffect.element.style.zIndex === String(operation.payload.layer)
      ) {
        const box = rectFromElement(existingEffect.element);
        return { ok: true, operation, verification: { ok: true, expected: box, actual: box } };
      }
      const signature = operation.target.signature;
      if (!signature) {
        return failure("missing_signature", false);
      }
      const identity = { signature };
      const resolved = resolveOrFail(null, identity);
      if ("error" in resolved) {
        return resolved;
      }
      const command = inferLayerCommandFromOperation(
        operation.metadata?.sourceCommand,
        operation.payload.layer,
        operation.payload.previousLayer,
      );
      const plan = resolveLayerPlan(resolved.element, command, snapshotStore, {
        explicitLayer: operation.payload.layer,
      });
      if (plan.verification !== "pass") {
        return failure(plan.reason ?? "layer_verification_failed", false);
      }
      const snapshot = captureElementDomSnapshot(plan.host, deps.document);
      applyLayerToHost(plan.host, operation.payload.layer, snapshotStore);
      layerEffects.set(operation.id, { element: plan.host, snapshot });
      const box = rectFromElement(resolved.element);
      return { ok: true, operation, verification: { ok: true, expected: box, actual: box } };
    },

    revertCommitted(operation) {
      if (operation.type === "zIndex") {
        const effect = layerEffects.get(operation.id);
        if (!effect) {
          return failure("missing_layer_effect", false);
        }
        const restored = rollback(effect.element, effect.snapshot);
        if (!restored) {
          return failure("rollback_failed", false);
        }
        const box = rectFromElement(effect.element);
        return { ok: true, operation, verification: { ok: true, expected: box, actual: box } };
      }
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
      return operation.type === "move" ? this.replayMove(operation) : this.replayLayer(operation);
    },

    revertCommittedBatch(operations): BatchExecutionResult {
      if (operations.length === 0) return failure("empty_batch", false);
      const prepared: Array<{
        operation: MoveOperation | ZIndexOperation;
        element: HTMLElement;
        currentSnapshot: ElementDomSnapshot;
        committedSnapshot: ElementDomSnapshot;
        expected: IntendedRect | null;
        nodeId: VisualNodeId | null;
        identity: DurableVisualIdentity;
      }> = [];
      for (const operation of operations) {
        const identity = operation.target.signature ? { signature: operation.target.signature } : null;
        if (!identity) return failure("missing_signature", false);
        const moveEffect = operation.type === "move" ? effects.get(operation.id) : null;
        const layerEffect = operation.type === "zIndex" ? layerEffects.get(operation.id) : null;
        const resolved = resolveOrFail(moveEffect?.nodeId ?? operation.target.nodeId ?? null, identity);
        if ("error" in resolved) return resolved;
        const committedSnapshot = moveEffect?.snapshot ?? layerEffect?.snapshot;
        if (!committedSnapshot) {
          return failure(operation.type === "move" ? "missing_move_effect" : "missing_layer_effect", false);
        }
        prepared.push({
          operation,
          element: resolved.element,
          currentSnapshot: captureElementDomSnapshot(resolved.element, deps.document),
          committedSnapshot,
          expected: operation.type === "move"
            ? moveEffect?.originalRect ?? operation.metadata?.originalRect ?? null
            : null,
          nodeId: resolved.nodeId,
          identity,
        });
      }

      const restoreCurrentWorld = (): boolean => {
        let restored = true;
        for (const item of [...prepared].reverse()) {
          restored = rollback(item.element, item.currentSnapshot) && restored;
        }
        return restored;
      };

      for (const item of [...prepared].reverse()) {
        if (!rollback(item.element, item.committedSnapshot)) {
          return failure("rollback_failed", restoreCurrentWorld());
        }
      }

      const verifications: VisualVerification[] = [];
      for (const item of prepared) {
        const actual = rectFromElement(item.element);
        const expected = item.expected ?? actual;
        const verification: VisualVerification = {
          ok: rectsNear(actual, expected),
          expected,
          actual,
        };
        if (!verification.ok) {
          return failure("undo_geometry_mismatch", restoreCurrentWorld(), verification);
        }
        if (!verifyIdentity(item.nodeId, item.identity, item.element)) {
          return failure("identity_uncertain", restoreCurrentWorld(), verification);
        }
        verifications.push(verification);
      }
      return {
        ok: true,
        operations,
        verifications,
      };
    },

    reapplyCommittedBatch(operations): BatchExecutionResult {
      if (operations.length === 0) return failure("empty_batch", false);
      const snapshots: Array<{ element: HTMLElement; snapshot: ElementDomSnapshot }> = [];
      const previousEffects = new Map<string, CapturedEffect | undefined>();
      for (const operation of operations) {
        const identity = operation.target.signature ? { signature: operation.target.signature } : null;
        if (!identity) return failure("missing_signature", false);
        const resolved = resolveOrFail(operation.target.nodeId ?? null, identity);
        if ("error" in resolved) return resolved;
        snapshots.push({ element: resolved.element, snapshot: captureElementDomSnapshot(resolved.element, deps.document) });
        if (operation.type === "move") previousEffects.set(operation.id, effects.get(operation.id));
      }
      const results: ExecutionResult[] = [];
      for (const operation of operations) {
        const result = this.reapplyCommitted(operation);
        if (!result.ok) {
          let rolledBack = true;
          for (const item of [...snapshots].reverse()) rolledBack = rollback(item.element, item.snapshot) && rolledBack;
          for (const [id, effect] of previousEffects) {
            if (effect) effects.set(id, effect); else effects.delete(id);
          }
          return failure(result.error, rolledBack, result.verification);
        }
        results.push(result);
      }
      return {
        ok: true,
        operations,
        verifications: results.map((result) => result.ok ? result.verification : undefined).filter((value): value is VisualVerification => Boolean(value)),
      };
    },
  };
}
