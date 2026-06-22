import type { OperationId } from "../ids.js";
import type { EditorOperation } from "../operations.js";
import { validateOperationForDom } from "../validation/validate-dom-operation.js";
import { ElementSnapshotStore } from "./element-snapshot.js";
import {
  applyCropOperation,
  revertClipChange,
} from "./handlers/crop-handler.js";
import {
  applyHideOperation,
  revertDisplayChange,
} from "./handlers/hide-handler.js";
import {
  applyMoveOperation,
  applyResizeOperation,
  applyRotateOperation,
  revertSizeChange,
  revertTransformStateChange,
} from "./handlers/transform-handler.js";
import {
  applyStyleOperation,
  revertStyleChange,
} from "./handlers/style-handler.js";
import {
  applyTextOperation,
  revertTextChange,
} from "./handlers/text-handler.js";
import {
  applyZIndexOperation,
  revertPositionChange,
  revertZIndexChange,
} from "./handlers/z-index-handler.js";
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

interface StoredDomEffect extends AppliedDomEffect {
  element: HTMLElement;
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
}

export class DomRuntimeAdapter {
  private readonly root: ParentNode;
  private readonly snapshotStore = new ElementSnapshotStore();
  private readonly effects = new Map<OperationId, StoredDomEffect>();

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
      signatureSummary: summarizeElementSignature(operation.target.signature),
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

      if (!element) {
        const result = createDomApplyFailure("target_not_found", "target_not_found");
        diagnostic.code = result.code;
        diagnostic.error = result.error;
        if (!diagnostic.failureReason) {
          diagnostic.failureReason = "target_not_found";
        }
        return { result, diagnostic };
      }

      const effect = this.applyToElement(element, validation.operation);
      this.effects.set(operation.id, { ...effect, element });
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

    for (const operation of operations) {
      const applied = this.applyOperationDetailed(operation);
      results.push(applied.result);
      diagnostics.push(applied.diagnostic);
    }

    return { results, diagnostics };
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

      this.revertEffect(stored);
      this.effects.delete(operation.id);
      return createDomApplySuccess();
    } catch (error) {
      return createDomApplyFailure(
        "dom_revert_failed",
        error instanceof Error ? error.message : "dom_revert_failed",
      );
    }
  }

  clearAppliedEffects(): void {
    for (const effect of [...this.effects.values()].reverse()) {
      this.revertEffect(effect);
    }
    this.effects.clear();
  }

  private applyToElement(element: HTMLElement, operation: EditorOperation): AppliedDomEffect {
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
        return applyZIndexOperation(element, operation, this.snapshotStore);
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

  private revertEffect(effect: StoredDomEffect): void {
    for (const change of [...effect.changes].reverse()) {
      switch (change.kind) {
        case "style":
          revertStyleChange(effect.element, change);
          break;
        case "text":
          revertTextChange(effect.element, change);
          break;
        case "display":
          revertDisplayChange(effect.element, change);
          break;
        case "zIndex":
          revertZIndexChange(effect.element, change);
          break;
        case "transform-state":
          revertTransformStateChange(effect.element, change);
          break;
        case "size":
          revertSizeChange(effect.element, change);
          break;
        case "position":
          revertPositionChange(effect.element, change);
          break;
        case "clip":
          revertClipChange(effect.element, change);
          break;
        case "visibility":
          break;
      }
    }
  }
}

export function createDomRuntimeAdapter(root: ParentNode): DomRuntimeAdapter {
  return new DomRuntimeAdapter(root);
}
