import type { MeasurementRect } from "../measurement/types.js";
import type { EditorOperation } from "../operations.js";
import { classifyRectAgainstWindow, type SaveWindowRectDisposition } from "./rect-classification.js";
import { resolveOperationAffectedRect } from "./resolve-operation-rect.js";

export type SaveWindowDisposition = SaveWindowRectDisposition;

export interface ClassifiedOperation {
  operation: EditorOperation;
  disposition: SaveWindowDisposition;
  reason: string;
  affectedRect: MeasurementRect | null;
}

export interface SaveWindowClassificationSummary {
  keptCount: number;
  revertedCount: number;
  ambiguousCount: number;
}

export interface SaveWindowClassification {
  kept: ClassifiedOperation[];
  reverted: ClassifiedOperation[];
  ambiguous: ClassifiedOperation[];
  summary: SaveWindowClassificationSummary;
}

export interface ClassifyOperationsOptions {
  root: ParentNode;
  operations: readonly EditorOperation[];
  windowRect: MeasurementRect;
}

export function classifyOperationsForSaveWindow(
  options: ClassifyOperationsOptions,
): SaveWindowClassification {
  const kept: ClassifiedOperation[] = [];
  const reverted: ClassifiedOperation[] = [];
  const ambiguous: ClassifiedOperation[] = [];

  for (const operation of options.operations) {
    const classified = classifyOperationForSaveWindow(
      options.root,
      operation,
      options.windowRect,
    );

    switch (classified.disposition) {
      case "keep":
        kept.push(classified);
        break;
      case "revert":
        reverted.push(classified);
        break;
      case "ambiguous":
        ambiguous.push(classified);
        break;
    }
  }

  return {
    kept,
    reverted,
    ambiguous,
    summary: {
      keptCount: kept.length,
      revertedCount: reverted.length,
      ambiguousCount: ambiguous.length,
    },
  };
}

export function classifyOperationForSaveWindow(
  root: ParentNode,
  operation: EditorOperation,
  windowRect: MeasurementRect,
): ClassifiedOperation {
  const resolution = resolveOperationAffectedRect(root, operation);
  if (resolution.unresolved || !resolution.rect) {
    return {
      operation,
      disposition: "ambiguous",
      reason: resolution.reason,
      affectedRect: null,
    };
  }

  const disposition = classifyRectAgainstWindow(resolution.rect, windowRect);
  return {
    operation,
    disposition,
    reason:
      disposition === "ambiguous"
        ? `${resolution.reason}:partial_overlap`
        : `${resolution.reason}:${disposition}`,
    affectedRect: resolution.rect,
  };
}

export function selectOperationsToKeep(
  classification: SaveWindowClassification,
): EditorOperation[] {
  return classification.kept.map((entry) => entry.operation);
}

export function selectOperationsToRevert(
  classification: SaveWindowClassification,
): EditorOperation[] {
  return [
    ...classification.reverted.map((entry) => entry.operation),
    ...classification.ambiguous.map((entry) => entry.operation),
  ];
}
