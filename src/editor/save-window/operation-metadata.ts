import type { ElementSignature } from "../element-signature.js";
import type { EditorOperation, OperationAffectedRect, OperationMetadata } from "../operations.js";
import { extractBoundingBox } from "../measurement/bounding-box.js";
import type { MeasurementRect } from "../measurement/types.js";
import { summarizeElementSignature } from "../dom/signature-matcher.js";
import type { TransformTarget } from "../transform/transform-target.js";

export function measurementRectToAffectedRect(rect: MeasurementRect): OperationAffectedRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

export function buildMetadataFromElement(
  element: HTMLElement,
  signature?: ElementSignature,
  sourceCommand?: string,
): OperationMetadata {
  const rect = extractBoundingBox(element);
  return {
    targetSummary: summarizeElementSignature(signature),
    affectedRect: measurementRectToAffectedRect(rect),
    ...(sourceCommand ? { sourceCommand } : {}),
  };
}

export function buildMetadataFromTransformTarget(
  target: TransformTarget,
  sourceCommand?: string,
): OperationMetadata {
  return {
    targetSummary: summarizeElementSignature(target.signature),
    affectedRect: {
      x: target.rect.x,
      y: target.rect.y,
      width: target.rect.width,
      height: target.rect.height,
    },
    ...(sourceCommand ? { sourceCommand } : {}),
  };
}

export function withOperationMetadata(
  operation: EditorOperation,
  metadata: OperationMetadata,
): EditorOperation {
  return {
    ...operation,
    metadata: {
      ...operation.metadata,
      ...metadata,
    },
  };
}
