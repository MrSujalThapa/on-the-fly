import type { EditorOperation } from "./operations.js";
import type { OperationBatchId } from "./ids.js";

export interface OperationBatch {
  id: OperationBatchId;
  operations: EditorOperation[];
  label?: string;
  createdAt: number;
}

export function createOperationBatch(
  id: OperationBatchId,
  operations: EditorOperation[],
  createdAt: number,
  label?: string,
): OperationBatch {
  const batch: OperationBatch = {
    id,
    operations,
    createdAt,
  };

  if (label !== undefined) {
    batch.label = label;
  }

  return batch;
}
