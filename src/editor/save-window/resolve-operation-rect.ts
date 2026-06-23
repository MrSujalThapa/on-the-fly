import { resolveDuplicateElement } from "../duplicate/duplicate-element.js";
import { extractBoundingBox } from "../measurement/bounding-box.js";
import type { MeasurementRect } from "../measurement/types.js";
import type { EditorOperation } from "../operations.js";
import { resolveTargetElement } from "../dom/resolve-target.js";

export interface OperationRectResolution {
  rect: MeasurementRect | null;
  unresolved: boolean;
  reason: string;
}

const HARD_TO_CLASSIFY_TYPES = new Set<EditorOperation["type"]>(["group", "ungroup"]);

export function resolveOperationAffectedRect(
  root: ParentNode,
  operation: EditorOperation,
): OperationRectResolution {
  if (HARD_TO_CLASSIFY_TYPES.has(operation.type)) {
    return {
      rect: null,
      unresolved: true,
      reason: "hard_to_classify_operation_type",
    };
  }

  if (operation.metadata?.finalRect) {
    return {
      rect: { ...operation.metadata.finalRect },
      unresolved: false,
      reason: "stored_final_rect",
    };
  }

  if (operation.metadata?.affectedRect) {
    return {
      rect: { ...operation.metadata.affectedRect },
      unresolved: false,
      reason: "stored_metadata_rect",
    };
  }

  if (operation.type === "insertImage") {
    const { x, y, width, height } = operation.payload;
    return {
      rect: { x, y, width, height },
      unresolved: false,
      reason: "insert_image_payload",
    };
  }

  if (operation.type === "insertHelperObject") {
    const { x, y, width, height } = operation.payload.rect;
    return {
      rect: { x, y, width, height },
      unresolved: false,
      reason: "insert_helper_payload",
    };
  }

  if (operation.type === "duplicate") {
    const clone = resolveDuplicateClone(root, operation.payload.cloneId);
    if (clone) {
      return {
        rect: extractBoundingBox(clone),
        unresolved: false,
        reason: "duplicate_current_rect",
      };
    }

    const { anchorLeft, anchorTop, anchorWidth, anchorHeight, offsetDx, offsetDy } =
      operation.payload;
    return {
      rect: {
        x: anchorLeft + offsetDx,
        y: anchorTop + offsetDy,
        width: anchorWidth,
        height: anchorHeight,
      },
      unresolved: false,
      reason: "duplicate_anchor_fallback",
    };
  }

  if (operation.type === "hide" && operation.payload.hidden) {
    return {
      rect: null,
      unresolved: true,
      reason: "hidden_without_stored_rect",
    };
  }

  const element = resolveTargetElement(root, operation.target);
  if (element) {
    return {
      rect: extractBoundingBox(element),
      unresolved: false,
      reason: "resolved_target_rect",
    };
  }

  return {
    rect: null,
    unresolved: true,
    reason: "unresolved_target",
  };
}

function resolveDuplicateClone(root: ParentNode, cloneId: string): HTMLElement | null {
  const document = root instanceof Document ? root : root.ownerDocument;
  if (!document) {
    return null;
  }

  return resolveDuplicateElement(document, cloneId);
}
