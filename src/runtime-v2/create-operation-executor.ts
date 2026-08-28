import type { EditorOperation, MoveOperation, ZIndexOperation } from "../editor/operations.js";
import type { PageKey } from "../editor/ids.js";
import { validateOperation } from "../editor/validation/validate-operation.js";
import { applyMoveOperation, applyResizeOperation, applyRotateOperation } from "../editor/dom/handlers/transform-handler.js";
import { applyHideOperation } from "../editor/dom/handlers/hide-handler.js";
import { applyDuplicateOperation } from "../editor/dom/handlers/duplicate-handler.js";
import { applyCreateElementOperation } from "../editor/dom/handlers/create-element-handler.js";
import { applyCropOperation } from "../editor/dom/handlers/crop-handler.js";
import { applyStyleOperation, styleRealizationTargets } from "../editor/dom/handlers/style-handler.js";
import { applyTextOperation, renderedVisibleText } from "../editor/dom/handlers/text-handler.js";
import { readStoredTransformState, rememberIndependentLocalSize } from "../editor/dom/element-snapshot.js";
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
import {
  MOVE_GEOMETRY_TOLERANCE_PX,
  type BatchExecutionResult,
  type ExecutionFailure,
  type ExecutionResult,
  type OperationExecutor,
  type VisualVerification,
} from "./operation-executor.js";
import { aabbFromLocalSize } from "./editor-parity-geometry.js";
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
    let payload = "{}";
    try {
      payload = JSON.stringify(data ?? {});
    } catch {
      payload = "\"unserializable\"";
    }
    console.info(`[otf-v2] ${message} ${payload}`);
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
  descendantStyles?: Array<{ element: HTMLElement; style: string | null }>;
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

function lastIndependentSize(
  operations: readonly EditorOperation[],
  nodeId: VisualNodeId,
  known?: { width: number; height: number },
): { width: number; height: number } | null {
  let resizeSize: { width: number; height: number } | null = null;
  for (const operation of operations) {
    if (operation.target.nodeId !== nodeId) continue;
    if (operation.type === "resize") {
      resizeSize = { width: operation.payload.width, height: operation.payload.height };
    }
  }
  const chosen = resizeSize ?? known;
  return chosen && chosen.width > 1 && chosen.height > 1 ? chosen : null;
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
      if (!rectsNear(rectFromElement(input.element), input.expected)) {
        applyMoveOperation(input.element, input.operation, snapshotStore);
      }
    } catch (error) {
      const rolledBack = rollbackApplied();
      return failure(error instanceof Error ? error.message : "apply_threw", rolledBack);
    }

    const actual = rectFromElement(input.element);
    const payloadW = input.operation.payload.detachedWidth;
    const payloadH = input.operation.payload.detachedHeight;
    const expectedIsRotatedAabb = Boolean(
      payloadW && payloadH && (
        Math.abs(input.expected.width - payloadW) > 6 || Math.abs(input.expected.height - payloadH) > 6
      ),
    );
    const originOk =
      Math.abs(actual.x - input.expected.x) <= 6 && Math.abs(actual.y - input.expected.y) <= 6;
    const independent = input.element.getAttribute("data-otf-detached") === "true";
    const movedOk = expectedIsRotatedAabb
      ? originOk
      : independent
        ? Math.abs((actual.x - originalRect.x) - input.operation.payload.dx) <= 6
          && Math.abs((actual.y - originalRect.y) - input.operation.payload.dy) <= 6
          && Math.abs(actual.width - originalRect.width) <= 8
          && Math.abs(actual.height - originalRect.height) <= 8
        : rectsNear(actual, input.expected);
    const verification: VisualVerification = {
      ok: movedOk,
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
    let operation = source;
    let element: HTMLElement;
    let nodeId: VisualNodeId | null = operation.target.nodeId ?? null;
    let snapshot: ElementDomSnapshot | null = null;
    let descendantStyles: Array<{ element: HTMLElement; style: string | null }> | undefined;
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
    } else if (source.type === "createElement") {
      operation = source;
      const existing = Array.from(deps.document.querySelectorAll("[data-otf-element-id]:not([data-otf-preview])")).filter(
        (candidate) => candidate.getAttribute("data-otf-element-id") === source.payload.elementId,
      );
      if (existing.length > 1) return failure("created_identity_collision", false);
      try {
        element = applyCreateElementOperation(deps.document, source, snapshotStore).element;
      } catch (error) {
        return failure(error instanceof Error ? error.message : "create_apply_failed", false);
      }
      const existingNode = deps.visualModel.get(source.payload.elementId);
      const adopted = existingNode
        ? (deps.visualModel.cache(source.payload.elementId, element), source.payload.elementId)
        : deps.visualModel.adopt(element);
      if (!adopted) {
        element.remove();
        return failure("create_adoption_failed", true);
      }
      nodeId = adopted;
      const identity = deps.visualModel.durableIdentityOf(adopted);
      if (!identity || adopted !== source.payload.elementId) {
        element.remove();
        return failure("create_identity_failed", true);
      }
      operation = freezeCommittedOperation({ ...source, target: { nodeId: adopted, signature: identity.signature }, status: "approved" });
      if (!useSessionNodeId && source.target.nodeId) replayBindings.set(source.target.nodeId, { nodeId: adopted, element });
    } else {
      if (!signature) return failure("missing_signature", false);
      const rebound = !useSessionNodeId && source.target.nodeId ? replayBindings.get(source.target.nodeId) : null;
      const resolved = rebound?.element.isConnected ? rebound : resolveOrFail(useSessionNodeId ? nodeId : null, { signature });
      if ("error" in resolved) return resolved;
      element = resolved.element;
      nodeId = resolved.nodeId;
      if (operation.type === "hide" && signature) {
        const durable = deps.visualModel.resolveIdentity({ signature });
        if (isResolvedVisual(durable) && durable.element !== element) {
          return failure("live_replay_identity_mismatch", false);
        }
      }
      snapshot = captureElementDomSnapshot(element, deps.document);
      descendantStyles = operation.type === "style"
        ? styleRealizationTargets(element, operation)
          .filter((target) => target !== element)
          .map((descendant) => ({ element: descendant, style: descendant.getAttribute("style") }))
        : undefined;
      if (descendantStyles && descendantStyles.length === 0) descendantStyles = undefined;
      try {
        if (operation.type === "hide") applyHideOperation(element, operation, snapshotStore);
        else if (operation.type === "resize") applyResizeOperation(element, operation, snapshotStore);
        else if (operation.type === "rotate") applyRotateOperation(element, operation, snapshotStore);
        else if (operation.type === "crop") applyCropOperation(element, operation, snapshotStore);
        else if (operation.type === "style") applyStyleOperation(element, operation, snapshotStore);
        else if (operation.type === "text") applyTextOperation(element, operation, snapshotStore);
        else if (operation.type === "zIndex") applyLayerToHost(element, operation.payload.layer, snapshotStore);
        else return failure("unsupported_transaction_operation", false);
      } catch (error) {
        rollback(element, snapshot);
        return failure(error instanceof Error ? error.message : "apply_threw", true);
      }
    }
    const actual = rectFromElement(element);
    const expectedRect = expected ?? actual;
    const hiddenOk = operation.type !== "hide" || (operation.payload.hidden
      ? element.style.display === "none" && element.getAttribute("data-otf-hidden") === "true"
      : element.getAttribute("data-otf-hidden") !== "true");
    const rotateOk = operation.type !== "rotate" || readStoredTransformState(element)?.rotate === operation.payload.degrees;
    const styleOk = operation.type !== "style" || (() => {
      const cssProperty = {
        color: "color", backgroundColor: "background-color", backgroundImage: "background-image",
        borderColor: "border-color", borderWidth: "border-width", borderRadius: "border-radius",
        fontSize: "font-size", fontWeight: "font-weight", textAlign: "text-align", opacity: "opacity",
        boxShadow: "box-shadow", filter: "filter",
      }[operation.payload.property];
      const probe = deps.document.createElement("div");
      probe.style.setProperty(cssProperty, operation.payload.value);
      const targets = styleRealizationTargets(element, operation);
      return targets.length > 0 && targets.every((target) =>
        target.style.getPropertyValue(cssProperty) === probe.style.getPropertyValue(cssProperty));
    })();
    const textOk = operation.type !== "text" || renderedVisibleText(element) === operation.payload.value.replace(/[\t\n\f\r ]+/g, " ").trim();
    const cropOk = operation.type !== "crop" || element.getAttribute("data-otf-crop") === JSON.stringify(operation.payload);
    const resizeGeometryOk = operation.type !== "resize" || (() => {
      const payloadW = operation.payload.width;
      const payloadH = operation.payload.height;
      const usedW = element.offsetWidth > 1 ? element.offsetWidth : actual.width;
      const usedH = element.offsetHeight > 1 ? element.offsetHeight : actual.height;
      const widthRealized = Math.abs(usedW - payloadW) <= MOVE_GEOMETRY_TOLERANCE_PX;
      const heightRealized = Math.abs(usedH - payloadH) <= MOVE_GEOMETRY_TOLERANCE_PX;
      const widthOk = widthRealized || usedW >= payloadW - MOVE_GEOMETRY_TOLERANCE_PX;
      const heightOk = heightRealized || usedH >= payloadH - MOVE_GEOMETRY_TOLERANCE_PX;
      const localOk = (widthRealized || heightRealized) && widthOk && heightOk;
      const rotate = readStoredTransformState(element)?.rotate ?? 0;
      const derived = aabbFromLocalSize(
        { x: actual.x, y: actual.y },
        { width: usedW, height: usedH },
        rotate,
      );
      const worldSizeOk =
        Math.abs(actual.width - derived.width) <= MOVE_GEOMETRY_TOLERANCE_PX &&
        Math.abs(actual.height - derived.height) <= MOVE_GEOMETRY_TOLERANCE_PX;
      const originOk = Math.abs(rotate) > 0.5 || !expected
        || (
          Math.abs(actual.x - expected.x) <= MOVE_GEOMETRY_TOLERANCE_PX &&
          Math.abs(actual.y - expected.y) <= MOVE_GEOMETRY_TOLERANCE_PX
        );
      return localOk && worldSizeOk && originOk;
    })();
    const identitySignature = operation.target.signature ?? signature;
    const identityOk = operation.type === "duplicate"
      ? Array.from(deps.document.querySelectorAll("[data-otf-clone-id]")).filter(
        (candidate) => candidate.getAttribute("data-otf-clone-id") === operation.payload.cloneId,
      ).length === 1
      : operation.type === "createElement"
        ? Array.from(deps.document.querySelectorAll("[data-otf-element-id]:not([data-otf-preview])")).filter(
          (candidate) => candidate.getAttribute("data-otf-element-id") === operation.payload.elementId,
        ).length === 1
      : Boolean(identitySignature && verifyIdentity(nodeId, { signature: identitySignature }, element));
    const geometryOk = operation.type === "resize"
      ? resizeGeometryOk
      : operation.type === "duplicate" || operation.type === "createElement"
        ? identityOk
        : true;
    if (!element.isConnected || !identityOk || !hiddenOk || !rotateOk || !styleOk || !textOk || !cropOk || !geometryOk) {
      if (snapshot) rollback(element, snapshot); else element.remove();
      const reason = !element.isConnected ? "disconnected"
        : !identityOk ? "identity"
        : !geometryOk ? "geometry"
        : !styleOk ? "style"
        : !textOk ? "text"
        : !rotateOk ? "rotate"
        : !cropOk ? "crop"
        : "hidden";
      return failure(`operation_verification_failed:${reason}`, true, { ok: false, expected: expectedRect, actual });
    }
    if (captureEffect && nodeId) genericEffects.set(operation.id, {
      nodeId,
      element,
      snapshot,
      originalRect: snapshot ? operation.metadata?.originalRect ?? null : null,
      ...(descendantStyles ? { descendantStyles } : {}),
    });
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
      for (const operation of input.operations) {
        if (operation.type === "duplicate" || operation.type === "createElement") continue;
        const signature = operation.target.signature;
        if (!signature) return failure("missing_signature", false);
        const resolved = resolveOrFail(operation.target.nodeId ?? null, { signature });
        if ("error" in resolved) return resolved;
        if (!resolved.element.isConnected) return failure("disconnected_batch_target", false);
      }
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

      const known = lastIndependentSize(deps.ledger.activeOperations(), input.nodeId);
      if (known) {
        rememberIndependentLocalSize(resolved.element, known.width, known.height);
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
        const known = lastIndependentSize(
          deps.ledger.activeOperations(),
          nodeId,
          input.knownSizes?.get(nodeId),
        );
        if (known) {
          rememberIndependentLocalSize(resolved.element, known.width, known.height);
        }
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
        for (const item of prepared) {
          if (rectsNear(rectFromElement(item.element), item.expected)) continue;
          applyMoveOperation(item.element, item.operation, snapshotStore);
        }
      } catch (error) {
        return failure(error instanceof Error ? error.message : "apply_threw", rollbackBatch());
      }

      const verifications: VisualVerification[] = [];
      for (const item of prepared) {
      const actual = rectFromElement(item.element);
      const independent = item.element.getAttribute("data-otf-detached") === "true";
      const movedOk = independent
        ? Math.abs((actual.x - item.originalRect.x) - item.operation.payload.dx) <= 6
          && Math.abs((actual.y - item.originalRect.y) - item.operation.payload.dy) <= 6
          && Math.abs(actual.width - item.originalRect.width) <= 8
          && Math.abs(actual.height - item.originalRect.height) <= 8
        : rectsNear(actual, item.expected);
      const verification = { ok: movedOk, expected: item.expected, actual };
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
      const promoted: EditorOperation[] = [];
      const rollbackPromotion = (): void => {
        for (const operation of [...promoted].reverse()) {
          this.revertCommitted(operation);
        }
      };
      // A stacking command must not move anything. Try to satisfy it in place
      // first; only an in-flow element that provably cannot win its stacking
      // contest is promoted to independent placement, because promotion pulls
      // the element out of its row and reflows its siblings underneath it.
      let plan = resolveLayerPlan(resolved.element, input.command, snapshotStore, { onDebug: debugLayer });
      if (plan.verification !== "pass" && !deps.placement.isIndependent(resolved.element)) {
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
          commit: false,
          captureEffect: true,
        });
        if (!independentResult.ok) {
          return independentResult;
        }
        promoted.push(independentResult.operation);
        plan = resolveLayerPlan(resolved.element, input.command, snapshotStore, { onDebug: debugLayer });
      }
      if (plan.verification !== "pass") {
        rollbackPromotion();
        return failure(plan.reason ?? "layer_verification_failed", promoted.length > 0);
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
        rollbackPromotion();
        return failure(validation.errors.join("; ") || "invalid_operation", promoted.length > 0);
      }
      applyLayerToHost(plan.host, plan.layer, snapshotStore);
      const verified = resolveLayerPlan(resolved.element, input.command, snapshotStore, {
        explicitLayer: plan.layer,
      });
      if (verified.verification !== "pass" || !verifyIdentity(input.nodeId, identity, resolved.element)) {
        rollback(plan.host, snapshot);
        rollbackPromotion();
        return failure("layer_verification_failed", true);
      }
      layerEffects.set(operation.id, { element: plan.host, snapshot });
      deps.ledger.commitBatch([...promoted, operation]);
      const box = rectFromElement(resolved.element);
      return { ok: true, operation, verification: { ok: true, expected: box, actual: box } };
    },

    replayMove(operation) {
      const identity = identityFromMove(operation);
      if (!identity) {
        return failure("missing_signature", false);
      }
      const liveId = operation.target.nodeId ?? null;
      const liveElement = liveId ? deps.visualModel.bind(liveId) : null;
      if (liveId && !liveElement) {
        deps.visualModel.invalidate(liveId);
      }
      const resolved = liveElement && liveId
        ? { nodeId: liveId, element: liveElement }
        : resolveOrFail(null, identity);
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
        if (operation.type === "duplicate" || operation.type === "createElement") {
          effect.element.remove();
          deps.visualModel.invalidate(effect.nodeId);
          const box = operation.metadata?.affectedRect ?? { x: 0, y: 0, width: 0, height: 0 };
          return { ok: true, operation, verification: { ok: true, expected: box, actual: box } };
        }
        if (!effect.snapshot || !rollback(effect.element, effect.snapshot)) return failure("rollback_failed", false);
        for (const descendant of effect.descendantStyles ?? []) {
          if (descendant.style === null) descendant.element.removeAttribute("style");
          else descendant.element.setAttribute("style", descendant.style);
        }
        const box = rectFromElement(effect.element);
        return { ok: true, operation, verification: { ok: true, expected: box, actual: box } };
      }
      if (operation.type === "zIndex") {
        const effect = layerEffects.get(operation.id) ?? genericEffects.get(operation.id);
        if (!effect?.snapshot) {
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
        const actual = rectFromElement(resolved.element);
        if (!verifyIdentity(resolved.nodeId, identity, resolved.element)) {
          return failure("identity_uncertain", false, { ok: false, expected: original, actual });
        }
        return { ok: true, operation, verification: { ok: true, expected: original, actual } };
      }
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

      const actual = rectFromElement(resolved.element);
      const verification: VisualVerification = {
        ok: rectsNear(actual, original, 16),
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
      if (operation.type === "zIndex" && !genericEffects.has(operation.id)) return this.replayLayer(operation);
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
