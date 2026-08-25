import type { CropOperation, StyleProperty } from "../../editor/operations.js";
import type { CreatedElementAppearance, CreatedElementContent, CreatedElementKind } from "../../editor/create/created-element.js";
import type { LayerCommand } from "../../editor/transform/layer-order.js";
import { projectCanonicalCheckpoint } from "../canonical-checkpoint.js";
import type { BatchExecutionResult, ExecutionResult } from "../operation-executor.js";
import type { OperationLedger } from "../operation-ledger.js";
import type { PlacementEngine } from "../placement-engine.js";
import type { VisualModel } from "../visual-model.js";
import { isResolvedVisual } from "../visual-model.js";
import { environmentError, errorFromExecutor, throwEnvironment } from "./environment-errors.js";
import type {
  ElementCapabilities,
  ElementId,
  ElementObservation,
  EnvironmentRect,
  GeometrySnapshot,
  OTFEnvironment,
  OTFOperation,
  OperationResult,
} from "./environment-types.js";
import { changeFromOperation } from "./operation-adapter.js";
import {
  collectObservableIds,
  computedStylesOf,
  elementOrigin,
  geometryOf,
  intersectsViewport,
  isVisuallyQueryable,
  readViewport,
  summarizeElement,
  visibleTextOf,
} from "./observation.js";

export interface OTFEnvironmentHost {
  readonly document: Document;
  readonly sessionId: string;
  readonly visualModel: VisualModel;
  readonly placement: PlacementEngine;
  readonly ledger: OperationLedger;
  selectedIds(): readonly ElementId[];
  groupIdOf(id: ElementId): string | null;
  capabilities(id: ElementId): ElementCapabilities | null;
  move(nodeIds: readonly ElementId[], dx: number, dy: number): BatchExecutionResult;
  resize(ids: readonly ElementId[], toBounds: EnvironmentRect): BatchExecutionResult;
  rotate(ids: readonly ElementId[], degrees: number): BatchExecutionResult;
  layer(id: ElementId, command: LayerCommand): ExecutionResult;
  style(ids: readonly ElementId[], styles: ReadonlyMap<StyleProperty, string>): BatchExecutionResult;
  editText(id: ElementId, value: string): ExecutionResult;
  crop(id: ElementId, insets: CropOperation["payload"]): ExecutionResult;
  create(input: {
    kind: CreatedElementKind;
    rect: { x: number; y: number; width: number; height: number };
    appearance?: CreatedElementAppearance;
    content?: CreatedElementContent;
    elementId?: string;
  }): ExecutionResult;
  delete(ids: readonly ElementId[]): BatchExecutionResult;
  duplicate(id: ElementId): BatchExecutionResult;
  group(ids: readonly ElementId[]): string | null;
  ungroup(): readonly ElementId[];
  undo(): BatchExecutionResult;
  redo(): BatchExecutionResult;
}

const QUERY_FIELDS = new Set(["text", "role", "tag", "origin", "within", "visibleOnly"]);

function logEnv(event: string, details?: Record<string, unknown>): void {
  if (typeof __OTF_DIAGNOSTICS_ENABLED__ !== "undefined" && __OTF_DIAGNOSTICS_ENABLED__) {
    console.info(`[otf-env] ${event}`, details ?? {});
  }
}

function bind(host: OTFEnvironmentHost, id: ElementId) {
  const resolved = host.visualModel.resolveNode(id);
  if (resolved.kind === "ambiguous") {
    return { ok: false as const, error: environmentError("ELEMENT_AMBIGUOUS", resolved.evidence.reason ?? "ambiguous_target", { id }) };
  }
  if (!isResolvedVisual(resolved)) {
    return { ok: false as const, error: environmentError("ELEMENT_NOT_FOUND", resolved.evidence.reason ?? "unresolved_target", { id }) };
  }
  return { ok: true as const, element: resolved.element };
}

function failResult(error: ReturnType<typeof environmentError>, target?: ElementId): OperationResult {
  return target ? { ok: false, target, error } : { ok: false, error };
}

function successResult(partial: {
  operationId?: string;
  target?: ElementId;
  before?: GeometrySnapshot;
  after?: GeometrySnapshot;
  revision?: number;
}): OperationResult {
  return {
    ok: true,
    ...(partial.operationId ? { operationId: partial.operationId } : {}),
    ...(partial.target ? { target: partial.target } : {}),
    ...(partial.before ? { before: partial.before } : {}),
    ...(partial.after ? { after: partial.after } : {}),
    ...(partial.revision !== undefined ? { revision: partial.revision } : {}),
  };
}

function fromExecution(result: ExecutionResult | BatchExecutionResult, target?: ElementId, before?: GeometrySnapshot, after?: GeometrySnapshot): OperationResult {
  if (!result.ok) return failResult(errorFromExecutor(result.error), target);
  const operation = "operation" in result ? result.operation : result.operations[0];
  const resolvedTarget = operation?.target.nodeId ?? target;
  return {
    ok: true,
    ...(operation ? { operationId: operation.id } : {}),
    ...(resolvedTarget ? { target: resolvedTarget } : {}),
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
}

function pageUrl(document: Document): string {
  return document.defaultView?.location.href ?? "";
}

function withAfter(host: OTFEnvironmentHost, result: OperationResult, target?: ElementId): OperationResult {
  if (!result.ok || !target) return result;
  const rebound = bind(host, target);
  return rebound.ok ? { ...result, after: geometryOf(rebound.element, host.placement) } : result;
}

function executeSharedTransform(
  host: OTFEnvironmentHost,
  operation: Extract<OTFOperation, { type: "resize" | "rotate" }>,
): OperationResult {
  const ids = operation.targets;
  if (ids.length === 0) {
    return failResult(environmentError("INVALID_OPERATION", "empty_targets"));
  }
  for (const id of ids) {
    const resolved = bind(host, id);
    if (!resolved.ok) {
      logEnv("execute-result", { type: operation.type, target: id, ok: false, error: resolved.error });
      return failResult(resolved.error, id);
    }
  }
  const first = ids[0];
  if (!first) return failResult(environmentError("INVALID_OPERATION", "empty_targets"));
  const firstBound = bind(host, first);
  const before = firstBound.ok ? geometryOf(firstBound.element, host.placement) : undefined;
  const executed = operation.type === "resize"
    ? host.resize(ids, operation.toBounds)
    : host.rotate(ids, operation.degrees);
  let result = fromExecution(executed, first, before);
  result = withAfter(host, result, result.target ?? first);
  logEnv("execute-result", {
    type: operation.type,
    targets: ids,
    ok: result.ok,
    operationId: result.operationId,
    revision: host.ledger.cursor,
    error: result.error,
  });
  return { ...result, revision: host.ledger.cursor };
}

export function createOTFEnvironment(host: OTFEnvironmentHost): OTFEnvironment {
  const checkpoints = new Map<string, { revision: number; label?: string }>();
  let checkpointCounter = 0;

  const requireElement = (id: ElementId): HTMLElement => {
    const resolved = bind(host, id);
    if (!resolved.ok) throwEnvironment(resolved.error);
    return resolved.element;
  };

  const executeOne = (operation: OTFOperation): OperationResult => {
    const revisionBefore = host.ledger.cursor;
    logEnv("execute", { operation, revision: revisionBefore });
    if (operation.type === "create") {
      const result = fromExecution(host.create(operation));
      logEnv("execute-result", { type: operation.type, ok: result.ok, revision: host.ledger.cursor, error: result.error });
      return { ...result, revision: host.ledger.cursor };
    }
    if (operation.type === "ungroup") {
      host.ungroup();
      return { ok: true, revision: host.ledger.cursor };
    }
    if (operation.type === "group") {
      const groupId = host.group(operation.targets);
      if (!groupId) return failResult(environmentError("INVALID_OPERATION", "group_failed"));
      return { ok: true, operationId: groupId, revision: host.ledger.cursor };
    }
    if (operation.type === "resize" || operation.type === "rotate") {
      return executeSharedTransform(host, operation);
    }

    const target = operation.target;
    const resolved = bind(host, target);
    if (!resolved.ok) {
      logEnv("execute-result", { type: operation.type, target, ok: false, error: resolved.error });
      return failResult(resolved.error, target);
    }
    const before = geometryOf(resolved.element, host.placement);
    let result: OperationResult;
    switch (operation.type) {
      case "move":
        result = fromExecution(host.move([target], operation.delta.x, operation.delta.y), target, before);
        break;
      case "layer":
        result = fromExecution(host.layer(target, operation.command), target, before);
        break;
      case "style":
        result = fromExecution(host.style([target], new Map([[operation.property, operation.value]])), target, before);
        break;
      case "text":
        result = fromExecution(host.editText(target, operation.value), target, before);
        break;
      case "crop":
        result = fromExecution(host.crop(target, operation.insets), target, before);
        break;
      case "delete":
        result = fromExecution(host.delete([target]), target, before);
        break;
      case "duplicate":
        result = fromExecution(host.duplicate(target), target, before);
        break;
      default:
        result = failResult(environmentError("UNSUPPORTED_OPERATION", "unsupported_operation"), target);
    }
    result = withAfter(host, result, result.target ?? target);
    logEnv("execute-result", {
      type: operation.type,
      target,
      ok: result.ok,
      operationId: result.operationId,
      revision: host.ledger.cursor,
      error: result.error,
    });
    return { ...result, revision: host.ledger.cursor };
  };

  const environment: OTFEnvironment = {
    // Sync runtime wrapped in Promise for the public contract.
    /* eslint-disable @typescript-eslint/require-await */
    async observe(options) {
      const selected = host.selectedIds();
      const selectedSet = new Set(selected);
      const scope = options?.scope ?? "viewport";
      const viewport = readViewport(host.document);
      const ids = scope === "selection" ? selected : collectObservableIds(host.document, host.visualModel, selected);
      const elements = ids.flatMap((id) => {
        const resolved = bind(host, id);
        if (!resolved.ok) return [];
        const summary = summarizeElement(id, resolved.element, selectedSet, host.placement);
        if (scope === "viewport") {
          const box = geometryOf(resolved.element, host.placement);
          if (!intersectsViewport(box, viewport)) return [];
        }
        return [summary];
      });
      return {
        sessionId: host.sessionId,
        url: pageUrl(host.document),
        viewport,
        selection: selected,
        elements,
        revision: host.ledger.cursor,
      };
    },

    async inspectElement(id) {
      const resolved = bind(host, id);
      if (!resolved.ok) throwEnvironment(resolved.error);
      const capabilities = host.capabilities(id);
      if (!capabilities) throwEnvironment(environmentError("ELEMENT_STALE", "missing_capabilities", { id }));
      const parent = host.visualModel.parentOf(id) ?? undefined;
      const group = host.groupIdOf(id) ?? undefined;
      const role = resolved.element.getAttribute("role")?.trim();
      const visibleText = visibleTextOf(resolved.element);
      const observation: ElementObservation = {
        id,
        origin: elementOrigin(resolved.element),
        tag: resolved.element.tagName.toLowerCase(),
        ...(role ? { role } : {}),
        ...(visibleText ? { visibleText } : {}),
        geometry: geometryOf(resolved.element, host.placement),
        computedStyle: computedStylesOf(resolved.element),
        capabilities,
        relationships: {
          ...(parent ? { parent } : {}),
          children: [...host.visualModel.childrenOf(id)],
          ...(group ? { group } : {}),
        },
      };
      return observation;
    },

    async findElements(query) {
      for (const key of Object.keys(query)) {
        if (!QUERY_FIELDS.has(key)) {
          throwEnvironment(environmentError("UNSUPPORTED_OPERATION", `unsupported_query_field:${key}`));
        }
      }
      const selected = host.selectedIds();
      const viewport = readViewport(host.document);
      const text = query.text?.trim().toLowerCase();
      const role = query.role?.trim().toLowerCase();
      const tag = query.tag?.trim().toLowerCase();
      const matches: ElementId[] = [];
      for (const id of collectObservableIds(host.document, host.visualModel, selected)) {
        const resolved = bind(host, id);
        if (!resolved.ok) continue;
        const element = resolved.element;
        const box = geometryOf(element, host.placement);
        if (query.visibleOnly !== false && !isVisuallyQueryable(element, box, viewport)) continue;
        if (query.origin && elementOrigin(element) !== query.origin) continue;
        if (tag && element.tagName.toLowerCase() !== tag) continue;
        if (role) {
          const actual = (element.getAttribute("role") ?? (element.tagName === "BUTTON" ? "button" : "")).toLowerCase();
          if (actual !== role) continue;
        }
        if (text && !visibleTextOf(element).toLowerCase().includes(text)) continue;
        if (query.within) {
          const within = bind(host, query.within);
          if (!within.ok) throwEnvironment(within.error);
          if (query.within !== id && !within.element.contains(element)) continue;
        }
        matches.push(id);
      }
      return matches;
    },

    async getGeometry(id) {
      return geometryOf(requireElement(id), host.placement);
    },

    async getComputedStyles(id) {
      return computedStylesOf(requireElement(id));
    },

    async execute(operation) {
      return executeOne(operation);
    },

    /**
     * Same-delta MOVE, homogeneous DELETE, and identical STYLE maps run as one ledger
     * transaction (`atomic: true`). Every other batch is sequential (`atomic: false`)
     * and stops on the first failure; later operations are not attempted.
     */
    async executeBatch(operations) {
      if (operations.length === 0) {
        return { ok: false, atomic: true, results: [], error: environmentError("INVALID_OPERATION", "empty_batch") };
      }
      const types = new Set(operations.map((operation) => operation.type));
      const allMoves = operations.every((operation): operation is Extract<OTFOperation, { type: "move" }> => operation.type === "move");
      if (allMoves) {
        const firstMove = operations[0];
        if (firstMove && operations.every((operation) => operation.delta.x === firstMove.delta.x && operation.delta.y === firstMove.delta.y)) {
        const targets = operations.map((operation) => operation.target);
        const before = new Map(targets.map((id) => {
          const resolved = bind(host, id);
          return [id, resolved.ok ? geometryOf(resolved.element, host.placement) : null] as const;
        }));
        for (const [id, box] of before) {
          if (!box) {
            const resolved = bind(host, id);
            return { ok: false, atomic: true, results: [failResult(resolved.ok ? environmentError("ELEMENT_STALE", "missing_geometry") : resolved.error, id)] };
          }
        }
        const executed = host.move(targets, firstMove.delta.x, firstMove.delta.y);
        const results: OperationResult[] = targets.map((id, index) => {
          if (!executed.ok) return failResult(errorFromExecutor(executed.error), id);
          const rebound = bind(host, id);
          const operationId = executed.operations[index]?.id;
          const prior = before.get(id);
          return successResult({
            target: id,
            revision: host.ledger.cursor,
            ...(operationId ? { operationId } : {}),
            ...(prior ? { before: prior } : {}),
            ...(rebound.ok ? { after: geometryOf(rebound.element, host.placement) } : {}),
          });
        });
        if (!executed.ok) return { ok: false, atomic: true, results, error: errorFromExecutor(executed.error) };
        return { ok: true, atomic: true, results };
        }
      }
      const allDeletes = operations.every((operation): operation is Extract<OTFOperation, { type: "delete" }> => operation.type === "delete");
      if (allDeletes) {
        const targets = operations.map((operation) => operation.target);
        const executed = host.delete(targets);
        const results: OperationResult[] = targets.map((id, index) => {
          if (!executed.ok) return failResult(errorFromExecutor(executed.error), id);
          const operationId = executed.operations[index]?.id;
          return successResult({
            target: id,
            revision: host.ledger.cursor,
            ...(operationId ? { operationId } : {}),
          });
        });
        if (!executed.ok) return { ok: false, atomic: true, results, error: errorFromExecutor(executed.error) };
        return { ok: true, atomic: true, results };
      }
      const allStyles = operations.every((operation): operation is Extract<OTFOperation, { type: "style" }> => operation.type === "style");
      if (allStyles) {
        const targets = [...new Set(operations.map((operation) => operation.target))];
        const maps = new Map<ElementId, Map<StyleProperty, string>>();
        for (const operation of operations) {
          const current = maps.get(operation.target) ?? new Map<StyleProperty, string>();
          current.set(operation.property, operation.value);
          maps.set(operation.target, current);
        }
        const first = [...maps.values()][0];
        const firstKey = first ? JSON.stringify([...first.entries()]) : "";
        const sameMap = [...maps.values()].every((value) => JSON.stringify([...value.entries()]) === firstKey);
        if (sameMap && maps.size > 0) {
          const styles = [...maps.values()][0] ?? new Map<StyleProperty, string>();
          const executed = host.style(targets, styles);
          const results: OperationResult[] = targets.map((id) => executed.ok
            ? { ok: true, target: id, revision: host.ledger.cursor }
            : failResult(errorFromExecutor(executed.error), id));
          if (!executed.ok) return { ok: false, atomic: true, results, error: errorFromExecutor(executed.error) };
          return { ok: true, atomic: true, results };
        }
        logEnv("execute-batch", { atomic: false, reason: "heterogeneous_styles", types: [...types] });
      }
      const results: OperationResult[] = [];
      for (const operation of operations) {
        const result = executeOne(operation);
        results.push(result);
        if (!result.ok) {
          return result.error
            ? { ok: false, atomic: false, results, error: result.error }
            : { ok: false, atomic: false, results };
        }
      }
      return { ok: true, atomic: false, results };
    },

    /** Records the current ledger revision. Not a snapshot of document state. */
    async checkpoint(label) {
      checkpointCounter += 1;
      const id = `otf-cp-${host.sessionId}-${String(host.ledger.cursor)}-${checkpointCounter.toString(36)}`;
      checkpoints.set(id, label ? { revision: host.ledger.cursor, label } : { revision: host.ledger.cursor });
      logEnv("checkpoint", { id, revision: host.ledger.cursor, label });
      return id;
    },

    /**
     * Walks undo/redo to the checkpoint revision.
     * If later history truncated that revision, fails with `checkpoint_invalidated`
     * and does not silently land on a different revision.
     */
    async rollback(id) {
      const checkpoint = checkpoints.get(id);
      if (!checkpoint) {
        return { ok: false, error: environmentError("ROLLBACK_FAILED", "unknown_checkpoint", { id }) };
      }
      if (checkpoint.revision > host.ledger.entries.length) {
        return { ok: false, error: environmentError("ROLLBACK_FAILED", "checkpoint_invalidated", { id, revision: checkpoint.revision }) };
      }
      while (host.ledger.cursor > checkpoint.revision) {
        const undone = host.undo();
        if (!undone.ok) return { ok: false, error: errorFromExecutor(undone.error) };
      }
      while (host.ledger.cursor < checkpoint.revision) {
        const redone = host.redo();
        if (!redone.ok) return { ok: false, error: errorFromExecutor(redone.error) };
      }
      logEnv("rollback", { id, revision: host.ledger.cursor });
      return { ok: true, revision: host.ledger.cursor };
    },

    async getChanges() {
      const projection = projectCanonicalCheckpoint(host.ledger.activeOperations());
      if (!projection.ok) {
        throwEnvironment(environmentError("INTERNAL_ERROR", projection.error));
      }
      return projection.operations.flatMap((operation) => {
        const change = changeFromOperation(operation);
        return change ? [change] : [];
      });
    },

    async getSessionState() {
      const selected = host.selectedIds();
      const counts = { host: 0, clone: 0, created: 0 };
      for (const id of collectObservableIds(host.document, host.visualModel, selected)) {
        const resolved = bind(host, id);
        if (!resolved.ok) continue;
        counts[elementOrigin(resolved.element)] += 1;
      }
      return {
        sessionId: host.sessionId,
        url: pageUrl(host.document),
        viewport: readViewport(host.document),
        selection: selected,
        revision: host.ledger.cursor,
        persistedRevision: host.ledger.persistedRevision,
        dirty: host.ledger.isDirty(),
        canUndo: host.ledger.canUndo(),
        canRedo: host.ledger.canRedo(),
        elementCounts: counts,
      };
    },
    /* eslint-enable @typescript-eslint/require-await */
  };

  return environment;
}
