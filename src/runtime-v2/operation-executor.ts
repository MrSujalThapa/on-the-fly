import type { MoveOperation } from "../editor/operations.js";
import type { ElementHandle } from "./element-registry.js";
import type { IntendedRect, MovePlacementPlan } from "./placement-engine.js";

export interface VisualVerification {
  readonly ok: boolean;
  readonly expected: IntendedRect;
  readonly actual: IntendedRect;
}

export type ExecutionSuccess = {
  readonly ok: true;
  readonly operation: MoveOperation;
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
    handle: ElementHandle;
    plan: MovePlacementPlan;
    operation: MoveOperation;
  }): ExecutionResult;
}
