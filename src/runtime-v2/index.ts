export type { EditorRuntime, PersistResult, ReplayResult } from "./editor-runtime.js";
export type {
  ElementHandle,
  ElementRegistry,
  ResolvedElement,
  ResolveResult,
  UnresolvedTarget,
} from "./element-registry.js";
export { isUnresolvedTarget } from "./element-registry.js";
export type { ExecutionResult, ExecutionFailure, ExecutionSuccess, OperationExecutor, VisualVerification } from "./operation-executor.js";
export type { OperationLedger } from "./operation-ledger.js";
export type { OverlayCoordinator } from "./overlay-coordinator.js";
export type {
  IntendedRect,
  MovePlacementPlan,
  MovePlacementRequest,
  MovePlacementStrategy,
  PlacementEngine,
} from "./placement-engine.js";
export type { RuntimeLifecycle } from "./runtime-lifecycle.js";
