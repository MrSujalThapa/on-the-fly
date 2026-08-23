import type { MoveOperation, ZIndexOperation } from "../editor/operations.js";
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
  readonly operation: MoveOperation | ZIndexOperation;
  readonly verification: VisualVerification;
};

export type ExecutionFailure = {
  readonly ok: false;
  readonly error: string;
  readonly rolledBack: boolean;
  readonly verification?: VisualVerification;
};

export type ExecutionResult = ExecutionSuccess | ExecutionFailure;

/**
 * The only Runtime V2 owner of host-page mutation for editor operations.
 * Transaction: resolve → snapshot → plan → apply → verify → commit ledger.
 * On verify failure: rollback → explicit failure. Never silent sibling writes.
 */
export interface OperationExecutor {
  executeMove(input: {
    nodeId: VisualNodeId;
    dx: number;
    dy: number;
    pageKey: PageKey;
  }): ExecutionResult;
  executeLayer(input: {
    nodeId: VisualNodeId;
    command: LayerCommand;
    pageKey: PageKey;
  }): ExecutionResult;
  replayMove(operation: MoveOperation): ExecutionResult;
  replayLayer(operation: ZIndexOperation): ExecutionResult;
  revertCommitted(operation: MoveOperation | ZIndexOperation): ExecutionResult;
  reapplyCommitted(operation: MoveOperation | ZIndexOperation): ExecutionResult;
}

export const MOVE_GEOMETRY_TOLERANCE_PX = 3;
