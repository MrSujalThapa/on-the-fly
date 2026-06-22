import { extractBoundingBox } from "../measurement/bounding-box.js";
import type { EditorOperation, OperationAffectedRect } from "../operations.js";
import { measurementRectToAffectedRect } from "../save-window/operation-metadata.js";

export function enrichOperationWithRects(
  operation: EditorOperation,
  originalRect: OperationAffectedRect,
  finalRect: OperationAffectedRect,
): EditorOperation {
  return {
    ...operation,
    metadata: {
      ...operation.metadata,
      originalRect,
      finalRect,
      affectedRect: finalRect,
    },
  };
}

export function enrichOperationsWithVisualRects(
  operations: EditorOperation[],
  originalElements: readonly HTMLElement[],
  finalElements: readonly HTMLElement[],
): EditorOperation[] {
  return operations.map((operation, index) => {
    const originalElement = originalElements[index];
    const finalElement = finalElements[index];
    if (!originalElement || !finalElement) {
      return operation;
    }

    const originalRect = measurementRectToAffectedRect(extractBoundingBox(originalElement));
    const finalRect = measurementRectToAffectedRect(extractBoundingBox(finalElement));
    return enrichOperationWithRects(operation, originalRect, finalRect);
  });
}
