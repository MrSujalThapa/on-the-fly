import type { EditorOperation, MoveOperation, ZIndexOperation } from "../editor/operations.js";
import type { PageKey } from "../editor/ids.js";
import { validateOperation } from "../editor/validation/validate-operation.js";
import { applyMoveOperation, applyResizeOperation, applyRotateOperation } from "../editor/dom/handlers/transform-handler.js";
import { applyHideOperation } from "../editor/dom/handlers/hide-handler.js";
import { applyDuplicateOperation } from "../editor/dom/handlers/duplicate-handler.js";
import { readStoredTransformState } from "../editor/dom/element-snapshot.js";
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

interface GenericEffect {
  nodeId: VisualNodeId;
  element: HTMLElement;
  snapshot: ElementDomSnapshot | null;
  originalRect: IntendedRect | null;
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
  const genericEffects = new Map<string, GenericEffect>();
  const layerEffects = new Map<string, { element: HTMLElement; snapshot: ElementDomSnapshot }>();
  const replayBindings = new Map<VisualNodeId, { nodeId: VisualNodeId | null; element: HTMLElement }>();

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

  const applyGeneric = (
    source: EditorOperation,
    expected: IntendedRect | undefined,
    captureEffect: boolean,
    useSessionNodeId = true,
  ): ExecutionResult => {
    if (source.type === "move") return applyAndVerifyOperation(source, expected, captureEffect);
    if (source.type === "zIndex") return failure("layer_requires_command", false);
    let operation = source;
    let element: HTMLElement;
    let nodeId: VisualNodeId | null = operation.target.nodeId ?? null;
    let snapshot: ElementDomSnapshot | null = null;
    const signature = operation.target.signature;
    if (operation.type === "duplicate") {
      try {
        element = applyDuplicateOperation(deps.document, operation, snapshotStore).element;
      } catch (error) {
        return failure(error instanceof Error ? error.message : "duplicate_apply_failed", false);
      }
      const adopted = deps.visualModel.adopt(element);
      if (!adopted) {
        element.remove();
        return failure("duplicate_adoption_failed", true);
      }
      nodeId = adopted;
      const identity = deps.visualModel.durableIdentityOf(adopted);
      if (!identity) {
        element.remove();
        return failure("duplicate_identity_failed", true);
      }
      operation = freezeCommittedOperation({ ...operation, target: { nodeId: adopted, signature: identity.signature }, status: "approved" });
      if (!useSessionNodeId && source.target.nodeId) replayBindings.set(source.target.nodeId, { nodeId: adopted, element });
    } else {
      if (!signature) return failure("missing_signature", false);
      const rebound = !useSessionNodeId && source.target.nodeId ? replayBindings.get(source.target.nodeId) : null;
      const resolved = rebound?.element.isConnected ? rebound : resolveOrFail(useSessionNodeId ? nodeId : null, { signature });
      if ("error" in resolved) return resolved;
      element = resolved.element;
      nodeId = resolved.nodeId;
      snapshot = captureElementDomSnapshot(element, deps.document);
      try {
        if (operation.type === "hide") applyHideOperation(element, operation, snapshotStore);
        else if (operation.type === "resize") applyResizeOperation(element, operation, snapshotStore);
        else if (operation.type === "rotate") applyRotateOperation(element, operation, snapshotStore);
        else return failure("unsupported_transaction_operation", false);
      } catch (error) {
        rollback(element, snapshot);
        return failure(error instanceof Error ? error.message : "apply_threw", true);
      }
    }
    const actual = rectFromElement(element);
    const expectedRect = expected ?? actual;
    const hiddenOk = operation.type !== "hide" || (operation.payload.hidden ? element.style.display === "none" : element.style.display !== "none");
    const rotateOk = operation.type !== "rotate" || readStoredTransformState(element)?.rotate === operation.payload.degrees;
    const geometryOk = operation.type === "resize" || operation.type === "duplicate" ? rectsNear(actual, expectedRect) : true;
    const identityOk = operation.type === "duplicate"
      ? Array.from(deps.document.querySelectorAll("[data-otf-clone-id]")).filter(
        (candidate) => candidate.getAttribute("data-otf-clone-id") === operation.payload.cloneId,
      ).length === 1
      : Boolean(signature && verifyIdentity(nodeId, { signature }, element));
    if (!element.isConnected || !identityOk || !hiddenOk || !rotateOk || !geometryOk) {
      if (snapshot) rollback(element, snapshot); else element.remove();
      return failure("operation_verification_failed", true, { ok: false, expected: expectedRect, actual });
    }
    if (captureEffect && nodeId) genericEffects.set(operation.id, { nodeId, element, snapshot, originalRect: snapshot ? operation.metadata?.originalRect ?? null : null });
    return { ok: true, operation, verification: { ok: true, expected: expectedRect, actual } };
  };

  const applyAndVerifyOperation = (
    operation: MoveOperation,
    expected: IntendedRect | undefined,
    captureEffect: boolean,
  ): ExecutionResult => {
    const signature = operation.target.signature;
    if (!signature) return failure("missing_signature", false);
    const identity = { signature };
    const resolved = resolveOrFail(operation.target.nodeId ?? null, identity);
    if ("error" in resolved) return resolved;
    const target = expected ?? operation.metadata?.finalRect;
    if (!target) return failure("missing_final_rect", false);
    return applyAndVerify({ nodeId: resolved.nodeId, identity, element: resolved.element, operation, expected: target, commit: false, captureEffect });
  };

  return {
    executeTransaction(input): BatchExecutionResult {
      if (input.operations.length === 0) return failure("empty_batch", false);
      const applied: Array<{ operation: EditorOperation; result: ExecutionResult }> = [];
      for (const operation of input.operations) {
        const result = applyGeneric(operation, input.expectedRects?.get(operation.id), true);
        if (!result.ok) {
          for (const item of [...applied].reverse()) this.revertCommitted(item.result.ok ? item.result.operation : item.operation);
          return failure(result.error, true, result.verification);
        }
        applied.push({ operation, result });
      }
      const committed = applied.map((item) => item.result.ok ? item.result.operation : item.operation);
      deps.ledger.commitBatch(committed);
      return { ok: true, operations: committed, verifications: applied.map((item) => item.result.ok ? item.result.verification : { ok: false, expected: {x:0,y:0,width:0,height:0}, actual:{x:0,y:0,width:0,height:0} }) };
    },
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
      if (uniqueIds.length !== input.nodeIds.length) return failure("duplicate_batch_target", false);
      const prepared: PreparedMove[] = [];
      const resolvedElements = new Set<HTMLElement>();

      for (const nodeId of uniqueIds) {
        const identity = deps.visualModel.durableIdentityOf(nodeId);
        if (!identity) return failure("missing_identity", false);
        const resolved = resolveOrFail(nodeId, identity);
        if ("error" in resolved) return resolved;
        if (resolvedElements.has(resolved.element)) return failure("duplicate_live_element", false);
        resolvedElements.add(resolved.element);
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

      const result = applyAndVerify({
        nodeId: resolved.nodeId,
        identity,
        element: resolved.element,
        operation: replayOperation,
        expected,
        commit: false,
        captureEffect: true,
      });
      if (result.ok && operation.target.nodeId) replayBindings.set(operation.target.nodeId, { nodeId: resolved.nodeId, element: resolved.element });
      return result;
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
      const rebound = operation.target.nodeId ? replayBindings.get(operation.target.nodeId) : null;
      const resolved = rebound?.element.isConnected
        ? { nodeId: rebound.nodeId, element: rebound.element }
        : resolveOrFail(null, identity);
      if ("error" in resolved) {
        return resolved;
      }
      if (rebound && resolved.element !== rebound.element) return failure("identity_mismatch", false);
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
      if (operation.type !== "move" && operation.type !== "zIndex") {
        const effect = genericEffects.get(operation.id);
        if (!effect) return failure("missing_operation_effect", false);
        if (operation.type === "duplicate") {
          effect.element.remove();
          const box = operation.metadata?.affectedRect ?? { x: 0, y: 0, width: 0, height: 0 };
          return { ok: true, operation, verification: { ok: true, expected: box, actual: box } };
        }
        if (!effect.snapshot || !rollback(effect.element, effect.snapshot)) return failure("rollback_failed", false);
        const box = rectFromElement(effect.element);
        return { ok: true, operation, verification: { ok: true, expected: box, actual: box } };
      }
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
      if (operation.type === "move") return this.replayMove(operation);
      if (operation.type === "zIndex") return this.replayLayer(operation);
      return applyGeneric(operation, operation.metadata?.finalRect ?? operation.metadata?.affectedRect, true);
    },

    replayOperation(operation) {
      if (operation.type === "move") return this.replayMove(operation);
      if (operation.type === "zIndex") return this.replayLayer(operation);
      return applyGeneric(operation, operation.metadata?.finalRect ?? operation.metadata?.affectedRect, true, false);
    },

    reconcileOperation(operation) {
      if (operation.type === "move") return this.replayMove(operation);
      if (operation.type === "zIndex") return this.replayLayer(operation);
      return applyGeneric(operation, operation.metadata?.finalRect ?? operation.metadata?.affectedRect, false);
    },

    revertCommittedBatch(operations): BatchExecutionResult {
      if (operations.length === 0) return failure("empty_batch", false);
      const undone: EditorOperation[] = [];
      const verifications: VisualVerification[] = [];
      for (const operation of [...operations].reverse()) {
        const result = this.revertCommitted(operation);
        if (!result.ok) {
          for (const prior of undone.reverse()) this.reapplyCommitted(prior);
          return failure(result.error, true, result.verification);
        }
        undone.push(operation);
        verifications.push(result.verification);
      }
      return { ok: true, operations, verifications: verifications.reverse() };
    },

    reapplyCommittedBatch(operations): BatchExecutionResult {
      if (operations.length === 0) return failure("empty_batch", false);
      const applied: EditorOperation[] = [];
      const verifications: VisualVerification[] = [];
      for (const operation of operations) {
        const result = this.reapplyCommitted(operation);
        if (!result.ok) {
          for (const prior of [...applied].reverse()) this.revertCommitted(prior);
          return failure(result.error, true, result.verification);
        }
        applied.push(result.operation);
        verifications.push(result.verification);
      }
      return { ok: true, operations: applied, verifications };
    },
  };
}
