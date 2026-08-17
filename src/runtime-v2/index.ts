export type { EditorRuntime, PersistResult, ReplayResult } from "./editor-runtime.js";
export { createEditorRuntime } from "./create-editor-runtime.js";
export type {
  AmbiguousTarget,
  ElementHandle,
  ElementRegistry,
  ResolvedElement,
  ResolveResult,
  UnresolvedTarget,
} from "./element-registry.js";
export { isAmbiguousTarget, isResolvedElement, isUnresolvedTarget } from "./element-registry.js";
export { createElementRegistry } from "./create-element-registry.js";
export type {
  ExecutionResult,
  ExecutionFailure,
  ExecutionSuccess,
  OperationExecutor,
  VisualVerification,
} from "./operation-executor.js";
export { createOperationExecutor } from "./create-operation-executor.js";
export type { LedgerEntry, OperationLedger } from "./operation-ledger.js";
export { createOperationLedger } from "./create-operation-ledger.js";
export type { OverlayCoordinator } from "./overlay-coordinator.js";
export type {
  IntendedRect,
  MovePlacementPlan,
  MovePlacementRequest,
  MovePlacementStrategy,
  PlacementEngine,
} from "./placement-engine.js";
export { createPlacementEngine } from "./create-placement-engine.js";
export type { RuntimeLifecycle } from "./runtime-lifecycle.js";
