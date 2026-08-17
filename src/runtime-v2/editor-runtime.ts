import type { ElementHandle, ElementRegistry } from "./element-registry.js";
import type { ExecutionResult, OperationExecutor } from "./operation-executor.js";
import type { OperationLedger } from "./operation-ledger.js";
import type { OverlayCoordinator } from "./overlay-coordinator.js";
import type { PlacementEngine } from "./placement-engine.js";
import type { RuntimeLifecycle } from "./runtime-lifecycle.js";

export interface PersistResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface ReplayResult {
  readonly ok: boolean;
  readonly applied: number;
  readonly unresolved: number;
  readonly failed: number;
}

/**
 * Human and future agent entry point. No agent-specific API.
 *
 * MOVE: registry.resolve → placement.planMove → executor.executeMove → ledger.append.
 */
export interface EditorRuntime {
  readonly registry: ElementRegistry;
  readonly placement: PlacementEngine;
  readonly executor: OperationExecutor;
  readonly ledger: OperationLedger;
  readonly overlays: OverlayCoordinator;
  readonly lifecycle: RuntimeLifecycle;
  move(handle: ElementHandle, dx: number, dy: number): ExecutionResult;
  save(): Promise<PersistResult>;
  replay(): Promise<ReplayResult>;
}
