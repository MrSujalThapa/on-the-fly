export type { EditorRuntime, PersistResult, ReplayResult } from "./editor-runtime.js";
export { createEditorRuntime } from "./create-editor-runtime.js";
export { createOTFEnvironment } from "./environment/OTFEnvironment.js";
export { OTFEnvironmentError } from "./environment/environment-errors.js";
export type { ElementId, ElementObservation, OTFEnvironment, OTFOperation, PageObservation } from "./environment/environment-types.js";
export type {
  AmbiguousVisual,
  DurableVisualIdentity,
  ResolvedVisual,
  UnresolvedVisual,
  VisualModel,
  VisualNode,
  VisualResolveResult,
  VisualRole,
} from "./visual-model.js";
export {
  isAmbiguousVisual,
  isResolvedVisual,
  isUnresolvedVisual,
} from "./visual-model.js";
export { createVisualModel } from "./create-visual-model.js";
export type { InputMode, InputRouter } from "./input-router.js";
export { createInputRouter } from "./create-input-router.js";
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
