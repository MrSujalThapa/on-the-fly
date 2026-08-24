import type { OperationId } from "../ids.js";
import type { EditorOperation } from "../operations.js";
import { validateOperationForDom } from "../validation/validate-dom-operation.js";
import { ElementSnapshotStore } from "./element-snapshot.js";
import {
  captureElementDomSnapshot,
  captureMissingElementDomSnapshot,
  elementSnapshotKey,
  restoreElementDomSnapshot,
  type ElementDomSnapshot,
} from "./dom-placement-snapshot.js";
import {
  buildBatchSnapshotFromEffects,
  restoreBatchSnapshot,
  type OperationBatchSnapshot,
  type RestoreBatchResult,
} from "./operation-batch-snapshot.js";
import {
  applyDuplicateOperation,
} from "./handlers/duplicate-handler.js";
import {
  applyCropOperation,
} from "./handlers/crop-handler.js";
import {
  applyHideOperation,
} from "./handlers/hide-handler.js";
import {
  applyInsertHelperObjectOperation,
} from "./handlers/helper-object-handler.js";
import {
  applyMoveOperation,
  applyResizeOperation,
  applyRotateOperation,
} from "./handlers/transform-handler.js";
import {
  applyStyleOperation,
} from "./handlers/style-handler.js";
import {
  applyTextOperation,
  revertTextChange,
} from "./handlers/text-handler.js";
import {
  applyLayerToHost,
  inferLayerCommandFromOperation,
  resolveLayerPlan,
} from "./layer-overlap-resolver.js";
import { resolveTargetElementDetailed } from "./resolve-target.js";
import {
  summarizeElementSignature,
  type SignatureMatchDiagnostics,
} from "./signature-matcher.js";
import {
  createDomApplyFailure,
  createDomApplySuccess,
  type AppliedDomEffect,
  type DomApplyResult,
} from "./types.js";
import { areDiagnosticsEnabled } from "../../shared/diagnostics.js";

interface StoredDomEffect extends AppliedDomEffect {
  element: HTMLElement;
  elementKey: string;
}

export interface ReplayOperationDiagnostic {
  operationId: string;
  operationType: string;
  signatureSummary: string;
  resolved: boolean;
  matchStrategy?: SignatureMatchDiagnostics["matchStrategy"];
  resolvedTag?: string;
  resolvedClasses?: string[];
  failureReason?: string;
  error?: string;
  code?: string;
}

export interface ReplayBatchResult {
  results: DomApplyResult[];
  diagnostics: ReplayOperationDiagnostic[];
  applied: number;
  skipped: number;
  unresolved: number;
}

export class DomRuntimeAdapter {
  private readonly root: ParentNode;
  private readonly snapshotStore = new ElementSnapshotStore();
  private readonly effects = new Map<OperationId, StoredDomEffect>();
  private readonly originSnapshots = new Map<string, ElementDomSnapshot>();
  private readonly elementRefs = new Map<string, HTMLElement>();

  constructor(root: ParentNode) {
    this.root = root;
  }

  getSnapshotStore(): ElementSnapshotStore {
    return this.snapshotStore;
  }

  /**
   * Applies an operation to the DOM. When `overrideElement` is supplied and is
   * still connected, it is used directly instead of re-resolving the target by
   * signature. This lets an active editing session transform the exact element
   * that was selected (DOM-first selection) even if its signature would match a
   * different element or fail to match at all.
   */
  applyOperation(operation: EditorOperation, overrideElement?: HTMLElement | null): DomApplyResult {
    return this.applyOperationDetailed(operation, overrideElement).result;
  }

  applyOperationDetailed(
    operation: EditorOperation,
    overrideElement?: HTMLElement | null,
  ): { result: DomApplyResult; diagnostic: ReplayOperationDiagnostic } {
    const diagnostic: ReplayOperationDiagnostic = {
      operationId: operation.id,
      operationType: operation.type,
      // Summarised only when a sink will read it: this runs for every operation
      // of every apply and every replay, and the resolve branch below overwrites
      // it anyway.
      signatureSummary: areDiagnosticsEnabled()
        ? summarizeElementSignature(operation.target.signature)
        : "",
      resolved: false,
    };

    const validation = validateOperationForDom(operation);
    if (!validation.ok) {
      const result = createDomApplyFailure(
        validation.codes.includes("unsupported_dom_operation")
          ? "unsupported_dom_operation"
          : "validation_failed",
        validation.errors.join("; "),
        validation.errors,
      );
      diagnostic.failureReason = result.error;
      diagnostic.code = result.code;
      diagnostic.error = result.error;
      return { result, diagnostic };
    }

    try {
      if (this.effects.has(operation.id)) {
        const result = createDomApplyFailure(
          "operation_already_applied",
          `operation_already_applied:${operation.id}`,
        );
        diagnostic.failureReason = result.error;
        diagnostic.code = result.code;
        diagnostic.error = result.error;
        return { result, diagnostic };
      }

      let element: HTMLElement | null = null;
      if (overrideElement && overrideElement.isConnected) {
        element = overrideElement;
        diagnostic.resolved = true;
        diagnostic.matchStrategy = "live-session";
        diagnostic.resolvedTag = element.tagName.toLowerCase();
        diagnostic.resolvedClasses = Array.from(element.classList);
      } else if (operation.type === "duplicate") {
        const document = resolveDocument(this.root);
        const existing = document.querySelector(
          `[data-otf-clone-id="${operation.payload.cloneId}"]`,
        );
        element = existing instanceof HTMLElement ? existing : null;
        if (element) {
          diagnostic.resolved = true;
          diagnostic.matchStrategy = "live-session";
          diagnostic.resolvedTag = element.tagName.toLowerCase();
          diagnostic.resolvedClasses = Array.from(element.classList);
        }
      } else if (operation.type === "insertHelperObject") {
        const document = resolveDocument(this.root);
        const existing = document.querySelector(
          `[data-otf-helper-id="${operation.payload.helperId}"]`,
        );
        element = existing instanceof HTMLElement ? existing : null;
        if (element) {
          diagnostic.resolved = true;
          diagnostic.matchStrategy = "live-session";
          diagnostic.resolvedTag = element.tagName.toLowerCase();
          diagnostic.resolvedClasses = Array.from(element.classList);
        }
      } else {
        const resolution = resolveTargetElementDetailed(this.root, operation.target);
        element = resolution.element;
        diagnostic.resolved = resolution.diagnostics.resolved;
        diagnostic.matchStrategy = resolution.diagnostics.matchStrategy;
        if (resolution.diagnostics.resolvedTag) {
          diagnostic.resolvedTag = resolution.diagnostics.resolvedTag;
        }
        if (resolution.diagnostics.resolvedClasses) {
          diagnostic.resolvedClasses = resolution.diagnostics.resolvedClasses;
        }
        if (resolution.diagnostics.failureReason) {
          diagnostic.failureReason = resolution.diagnostics.failureReason;
        }
        diagnostic.signatureSummary = resolution.diagnostics.signatureSummary;
      }

      if (!element && operation.type !== "duplicate" && operation.type !== "insertHelperObject") {
        const result = createDomApplyFailure("target_not_found", "target_not_found");
        diagnostic.code = result.code;
        diagnostic.error = result.error;
        if (!diagnostic.failureReason) {
          diagnostic.failureReason = "target_not_found";
        }
        return { result, diagnostic };
      }

      if (operation.type === "duplicate") {
        const beforeSnapshot = captureMissingElementDomSnapshot();
        const applied = applyDuplicateOperation(
          resolveDocument(this.root),
          operation,
          this.snapshotStore,
          element,
        );
        element = applied.element;
        const afterSnapshot = captureElementDomSnapshot(element, this.root);
        const elementKey = elementSnapshotKey(element, this.root);
        diagnostic.resolved = true;
        diagnostic.resolvedTag = element.tagName.toLowerCase();
        diagnostic.resolvedClasses = Array.from(element.classList);
        this.storeEffect(operation.id, {
          operationId: operation.id,
          changes: applied.changes,
          beforeSnapshot,
          afterSnapshot,
          element,
          elementKey,
        });
        return { result: createDomApplySuccess(), diagnostic };
      }

      if (operation.type === "insertHelperObject") {
        const beforeSnapshot = element
          ? captureElementDomSnapshot(element, this.root)
          : captureMissingElementDomSnapshot();
        const applied = applyInsertHelperObjectOperation(
          resolveDocument(this.root),
          operation,
          this.snapshotStore,
          element,
        );
        element = applied.element;
        const afterSnapshot = captureElementDomSnapshot(element, this.root);
        const elementKey = elementSnapshotKey(element, this.root);
        diagnostic.resolved = true;
        diagnostic.resolvedTag = element.tagName.toLowerCase();
        diagnostic.resolvedClasses = Array.from(element.classList);
        this.storeEffect(operation.id, {
          operationId: operation.id,
          changes: applied.changes,
          beforeSnapshot,
          afterSnapshot,
          element,
          elementKey,
        });
        return { result: createDomApplySuccess(), diagnostic };
      }

      if (validation.operation.type === "zIndex") {
        const zIndexOp = validation.operation;
        const selected = element as HTMLElement;
        const command = inferLayerCommandFromOperation(
          zIndexOp.metadata?.sourceCommand ?? null,
          zIndexOp.payload.layer,
          zIndexOp.payload.previousLayer,
        );
        const plan = resolveLayerPlan(selected, command, this.snapshotStore, {
          explicitLayer: zIndexOp.payload.layer,
        });
        const effectElement = plan.host;
        const beforeSnapshot = captureElementDomSnapshot(effectElement, this.root);
        const changes = applyLayerToHost(
          effectElement,
          zIndexOp.payload.layer,
          this.snapshotStore,
        );
        const afterSnapshot = captureElementDomSnapshot(effectElement, this.root);
        const elementKey = elementSnapshotKey(effectElement, this.root);
        diagnostic.resolvedTag = effectElement.tagName.toLowerCase();
        diagnostic.resolvedClasses = Array.from(effectElement.classList);
        this.storeEffect(zIndexOp.id, {
          operationId: zIndexOp.id,
          changes,
          beforeSnapshot,
          afterSnapshot,
          element: effectElement,
          elementKey,
        });
        return { result: createDomApplySuccess(), diagnostic };
      }

      const beforeSnapshot = captureElementDomSnapshot(element as HTMLElement, this.root);
      const changes = this.applyToElement(element as HTMLElement, validation.operation);
      const afterSnapshot = captureElementDomSnapshot(element as HTMLElement, this.root);
      const elementKey = elementSnapshotKey(element as HTMLElement, this.root);

      this.storeEffect(operation.id, {
        operationId: operation.id,
        changes,
        beforeSnapshot,
        afterSnapshot,
        element: element as HTMLElement,
        elementKey,
      });
      return { result: createDomApplySuccess(), diagnostic };
    } catch (error) {
      const result = createDomApplyFailure(
        "dom_apply_failed",
        error instanceof Error ? error.message : "dom_apply_failed",
      );
      diagnostic.failureReason = result.error;
      diagnostic.code = result.code;
      diagnostic.error = result.error;
      return { result, diagnostic };
    }
  }

  replayOperations(operations: EditorOperation[]): DomApplyResult[] {
    return this.replayOperationsWithDiagnostics(operations).results;
  }

  replayOperationsWithDiagnostics(operations: EditorOperation[]): ReplayBatchResult {
    const results: DomApplyResult[] = [];
    const diagnostics: ReplayOperationDiagnostic[] = [];
    let applied = 0;
    let skipped = 0;
    let unresolved = 0;

    for (const operation of operations) {
      const appliedResult = this.applyOperationDetailed(operation);
      results.push(appliedResult.result);
      diagnostics.push(appliedResult.diagnostic);

      if (appliedResult.result.ok) {
        applied += 1;
        continue;
      }

      if (appliedResult.result.code === "operation_already_applied") {
        skipped += 1;
        continue;
      }

      if (!appliedResult.diagnostic.resolved) {
        unresolved += 1;
      }
    }

    return { results, diagnostics, applied, skipped, unresolved };
  }

  revertOperation(operation: EditorOperation): DomApplyResult {
    const validation = validateOperationForDom(operation);
    if (!validation.ok) {
      return createDomApplyFailure("validation_failed", validation.errors.join("; "), validation.errors);
    }

    try {
      const stored = this.effects.get(operation.id);
      if (!stored) {
        return createDomApplyFailure(
          "operation_not_applied",
          `operation_not_applied:${operation.id}`,
        );
      }

      if (operation.type === "text") {
        const change = stored.changes.find(
          (candidate): candidate is Extract<AppliedDomEffect["changes"][number], { kind: "text" }> => candidate.kind === "text",
        );
        if (change) revertTextChange(stored.element, change);
      }
      restoreElementDomSnapshot(this.root, stored.beforeSnapshot, stored.element);
      this.effects.delete(operation.id);
      this.elementRefs.delete(stored.elementKey);
      return createDomApplySuccess();
    } catch (error) {
      return createDomApplyFailure(
        "dom_revert_failed",
        error instanceof Error ? error.message : "dom_revert_failed",
      );
    }
  }

  buildBatchSnapshot(operations: readonly EditorOperation[]): OperationBatchSnapshot {
    return buildBatchSnapshotFromEffects(this.root, operations, this.effects);
  }

  restoreBatchSnapshot(
    snapshot: OperationBatchSnapshot,
    mode: "before" | "after",
  ): RestoreBatchResult {
    const restore = restoreBatchSnapshot(
      this.root,
      snapshot,
      mode,
      (elementKey) => this.elementRefs.get(elementKey) ?? null,
    );
    if (restore.restored === 0 && restore.failed > 0) {
      return restore;
    }
    if (mode === "before") {
      for (const entry of snapshot.elements) {
        for (const operationId of entry.operationIds) {
          this.effects.delete(operationId);
        }
        if (!entry.before.existed) {
          this.elementRefs.delete(entry.elementKey);
        }
      }
      return restore;
    }

    for (const entry of snapshot.elements) {
      const element = this.elementRefs.get(entry.elementKey);
      if (element?.isConnected) {
        for (const operationId of entry.operationIds) {
          const stored = this.effects.get(operationId);
          if (stored) {
            stored.afterSnapshot = entry.after;
            continue;
          }
          this.storeEffect(operationId, {
            operationId,
            changes: [],
            beforeSnapshot: entry.before,
            afterSnapshot: entry.after,
            element,
            elementKey: entry.elementKey,
          });
        }
      }
    }
    return restore;
  }

  removeEffectsByOperationIds(ids: ReadonlySet<string>): void {
    for (const id of ids) {
      const stored = this.effects.get(id);
      if (stored) {
        this.effects.delete(id);
      }
    }
  }

  clearAppliedEffects(
    onRevertFailure?: (operationId: string, error: string) => void,
  ): void {
    for (const [elementKey, snapshot] of [...this.originSnapshots.entries()]) {
      try {
        const element = this.elementRefs.get(elementKey) ?? null;
        restoreElementDomSnapshot(this.root, snapshot, element);
      } catch (error) {
        const message = error instanceof Error ? error.message : "dom_revert_failed";
        onRevertFailure?.(elementKey, message);
      }
    }

    this.effects.clear();
    this.originSnapshots.clear();
    this.elementRefs.clear();
  }

  private storeEffect(operationId: OperationId, effect: StoredDomEffect): void {
    if (!this.originSnapshots.has(effect.elementKey)) {
      this.originSnapshots.set(effect.elementKey, effect.beforeSnapshot);
    }
    this.effects.set(operationId, effect);
    this.elementRefs.set(effect.elementKey, effect.element);
  }

  private applyToElement(element: HTMLElement, operation: EditorOperation): AppliedDomEffect["changes"] {
    switch (operation.type) {
      case "style":
        return applyStyleOperation(element, operation, this.snapshotStore);
      case "text":
        return applyTextOperation(element, operation, this.snapshotStore);
      case "hide":
        return applyHideOperation(element, operation, this.snapshotStore);
      case "crop":
        return applyCropOperation(element, operation, this.snapshotStore);
      case "zIndex":
        throw new Error("zIndex_apply_must_use_overlap_resolver");
      case "move":
        return applyMoveOperation(element, operation, this.snapshotStore);
      case "resize":
        return applyResizeOperation(element, operation, this.snapshotStore);
      case "rotate":
        return applyRotateOperation(element, operation, this.snapshotStore);
      default:
        throw new Error(`unsupported_dom_operation:${operation.type}`);
    }
  }
}

export function createDomRuntimeAdapter(root: ParentNode): DomRuntimeAdapter {
  return new DomRuntimeAdapter(root);
}

function resolveDocument(root: ParentNode): Document {
  if ("body" in root && root.body) {
    return root as Document;
  }

  if (root.ownerDocument) {
    return root.ownerDocument;
  }

  throw new Error("document_unavailable");
}
