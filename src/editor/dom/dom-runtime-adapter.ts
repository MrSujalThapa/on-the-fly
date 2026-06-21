import type { OperationId } from "../ids.js";
import type { EditorOperation } from "../operations.js";
import { assertValidOperation } from "../validation/validate-operation.js";
import { ElementSnapshotStore } from "./element-snapshot.js";
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
  revertZIndexChange,
} from "./handlers/z-index-handler.js";
import { resolveTargetElement } from "./resolve-target.js";
import type { AppliedDomEffect, DomApplyResult } from "./types.js";

const SUPPORTED_DOM_OPERATIONS = new Set<EditorOperation["type"]>([
  "style",
  "text",
  "hide",
  "zIndex",
  "move",
  "resize",
  "rotate",
]);

interface StoredDomEffect extends AppliedDomEffect {
  element: HTMLElement;
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

  applyOperation(operation: EditorOperation): DomApplyResult {
    try {
      assertValidOperation(operation);

      if (!SUPPORTED_DOM_OPERATIONS.has(operation.type)) {
        return { ok: false, error: `unsupported_dom_operation:${operation.type}` };
      }

      if (this.effects.has(operation.id)) {
        return { ok: false, error: `operation_already_applied:${operation.id}` };
      }

      const element = resolveTargetElement(this.root, operation.target);
      if (!element) {
        return { ok: false, error: "target_not_found" };
      }

      const effect = this.applyToElement(element, operation);
      this.effects.set(operation.id, { ...effect, element });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "dom_apply_failed",
      };
    }
  }

  revertOperation(operation: EditorOperation): DomApplyResult {
    try {
      assertValidOperation(operation);

      const stored = this.effects.get(operation.id);
      if (!stored) {
        return { ok: false, error: `operation_not_applied:${operation.id}` };
      }

      this.revertEffect(stored);
      this.effects.delete(operation.id);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "dom_revert_failed",
      };
    }
  }

  replayOperations(operations: EditorOperation[]): DomApplyResult[] {
    return operations.map((operation) => this.applyOperation(operation));
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
        case "visibility":
        case "position":
          break;
      }
    }
  }
}

export function createDomRuntimeAdapter(root: ParentNode): DomRuntimeAdapter {
  return new DomRuntimeAdapter(root);
}
