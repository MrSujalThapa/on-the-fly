import type { EditorOperation, MoveOperation, ZIndexOperation } from "../editor/operations.js";
import type { LayerCommand } from "../editor/transform/layer-order.js";
import type { PageKey, VisualNodeId } from "../editor/ids.js";
import type { IntendedRect } from "./placement-engine.js";

export interface VisualVerification {
  readonly ok: boolean;
  readonly expected: IntendedRect;
  readonly actual: IntendedRect;
}

export type ExecutionSuccess = {
  readonly ok: true;
  readonly operation: EditorOperation;
  readonly verification: VisualVerification;
};

export type ExecutionFailure = {
  readonly ok: false;
  readonly error: string;
  readonly rolledBack: boolean;
  readonly verification?: VisualVerification;
};

export type ExecutionResult = ExecutionSuccess | ExecutionFailure;

export type BatchExecutionSuccess = {
  readonly ok: true;
  readonly operations: readonly EditorOperation[];
  readonly verifications: readonly VisualVerification[];
};

export type BatchExecutionResult = BatchExecutionSuccess | ExecutionFailure;

/**
 * The only Runtime V2 owner of host-page mutation for editor operations.
 * Transaction: resolve → snapshot → plan → apply → verify → commit ledger.
 * On verify failure: rollback → explicit failure. Never silent sibling writes.
 */
export interface OperationExecutor {
  executeTransaction(input: {
    operations: readonly EditorOperation[];
    expectedRects?: ReadonlyMap<string, IntendedRect>;
  }): BatchExecutionResult;
  executeMove(input: {
    nodeId: VisualNodeId;
    dx: number;
    dy: number;
    pageKey: PageKey;
  }): ExecutionResult;
  executeMoveBatch(input: {
    nodeIds: readonly VisualNodeId[];
    dx: number;
    dy: number;
    pageKey: PageKey;
  }): BatchExecutionResult;
  executeLayer(input: {
    nodeId: VisualNodeId;
    command: LayerCommand;
    pageKey: PageKey;
  }): ExecutionResult;
  replayMove(operation: MoveOperation): ExecutionResult;
  replayLayer(operation: ZIndexOperation): ExecutionResult;
  replayOperation(operation: EditorOperation): ExecutionResult;
  reconcileOperation(operation: EditorOperation): ExecutionResult;
  revertCommitted(operation: EditorOperation): ExecutionResult;
  reapplyCommitted(operation: EditorOperation): ExecutionResult;
  revertCommittedBatch(operations: readonly EditorOperation[]): BatchExecutionResult;
  reapplyCommittedBatch(operations: readonly EditorOperation[]): BatchExecutionResult;
}

export const MOVE_GEOMETRY_TOLERANCE_PX = 3;
