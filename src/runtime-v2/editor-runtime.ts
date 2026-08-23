import type { VisualNodeId } from "../editor/ids.js";
import type { LayerCommand } from "../editor/transform/layer-order.js";
import type { ExecutionResult, OperationExecutor } from "./operation-executor.js";
import type { OperationLedger } from "./operation-ledger.js";
import type { OverlayCoordinator } from "./overlay-coordinator.js";
import type { PlacementEngine } from "./placement-engine.js";
import type { InputRouter } from "./input-router.js";
import type { RuntimeLifecycle } from "./runtime-lifecycle.js";
import type { VisualModel } from "./visual-model.js";

export interface PersistResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly failureKind?: "LEDGER" | "PERSISTENCE" | "IDENTITY" | "EXECUTION";
}

export interface ReplayResult {
  readonly ok: boolean;
  readonly applied: number;
  readonly unresolved: number;
  readonly failed: number;
  readonly failureKind?: "LEDGER" | "PERSISTENCE" | "IDENTITY" | "EXECUTION";
}

/**
 * Human and future agent entry point. No agent-specific API.
 *
 * MOVE: visualModel.resolve → placement.planMove → executor.executeMove → ledger.append.
 */
export interface EditorRuntime {
  readonly visualModel: VisualModel;
  readonly placement: PlacementEngine;
  readonly executor: OperationExecutor;
  readonly ledger: OperationLedger;
  readonly overlays: OverlayCoordinator;
  readonly input: InputRouter;
  readonly lifecycle: RuntimeLifecycle;
  start(): void;
  stop(): void;
  select(element: HTMLElement): VisualNodeId | null;
  selectParent(): VisualNodeId | null;
  move(nodeId: VisualNodeId, dx: number, dy: number): ExecutionResult;
  layer(nodeId: VisualNodeId, command: LayerCommand): ExecutionResult;
  undo(): ExecutionResult;
  redo(): ExecutionResult;
  save(): Promise<PersistResult>;
  replay(): Promise<ReplayResult>;
}
