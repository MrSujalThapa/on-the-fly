export type {
  GroupId,
  OperationBatchId,
  OperationId,
  OtfId,
  PageKey,
  SiteOrigin,
  VisualNodeId,
} from "./ids.js";

export type { BoundingBoxHint, ElementSignature } from "./element-signature.js";
export { createEmptyBoundingBoxHint } from "./element-signature.js";

export type { EditorTarget } from "./editor-target.js";
export { hasEditorTargetReference } from "./editor-target.js";

export type {
  VisualNode,
  VisualNodeComputedStyles,
  VisualNodeKind,
  VisualNodeRect,
} from "./visual-node.js";

export type { EditorSelection, SelectionSource } from "./editor-selection.js";
export { createEmptySelection } from "./editor-selection.js";

export type {
  CommandAppliesTo,
  CommandContext,
  CommandGroup,
  EditorCommand,
} from "./editor-command.js";

export type {
  CropOperation,
  EditorOperation,
  EditorOperationType,
  GroupOperation,
  HideOperation,
  InsertImageOperation,
  MoveOperation,
  OperationBase,
  OperationSource,
  OperationStatus,
  ResizeMode,
  ResizeOperation,
  RotateOperation,
  StyleOperation,
  StyleProperty,
  TextOperation,
  UngroupOperation,
  ZIndexOperation,
} from "./operations.js";
export { isEditorOperationType, OPERATION_TYPES } from "./operations.js";

export type { OperationBatch } from "./operation-batch.js";
export { createOperationBatch } from "./operation-batch.js";

export type { EditorState, GroupState } from "./editor-state.js";
export { cloneEditorState, createInitialEditorState } from "./editor-state.js";

export { isDangerousCssPath, isDangerousTagName } from "./validation/dangerous-selectors.js";
export type { ValidationResult } from "./validation/validate-signature.js";
export {
  createValidationFailure,
  createValidationSuccess,
  validateElementSignature,
} from "./validation/validate-signature.js";
export { validateEditorTarget } from "./validation/validate-target.js";
export {
  assertValidOperation,
  validateOperation,
  validateOperations,
} from "./validation/validate-operation.js";

export {
  approveDraftOperations,
  applyOperation,
  clearDraftAndPreview,
  getApprovedOperations,
  getGroupState,
  OperationApplyError,
  replayOperations,
  revertOperation,
} from "./engine/apply-operation.js";

export type {
  EditorHistory,
  HistoryApplyResult,
  HistoryRedoResult,
  HistoryUndoResult,
} from "./history/history-manager.js";
export {
  applyBatchToState,
  commitBatch,
  createBatchFromOperations,
  createEditorHistory,
  recordAppliedBatch,
  redo,
  undo,
} from "./history/history-manager.js";

export type {
  AppliedDomEffect,
  DomApplyResult,
  DomChange,
  ElementStyleSnapshot,
  MatchViewport,
  StoredTransformState,
} from "./dom/types.js";
export { OTF_MANAGED_ATTR, OTF_TRANSFORM_ATTR } from "./dom/types.js";
export { ElementSnapshotStore, captureElementSnapshot } from "./dom/element-snapshot.js";
export { matchElementBySignature, getMatchViewport } from "./dom/signature-matcher.js";
export { resolveTargetElement } from "./dom/resolve-target.js";
export { DomRuntimeAdapter, createDomRuntimeAdapter } from "./dom/dom-runtime-adapter.js";
export {
  DomOperationPipeline,
  createDomOperationPipeline,
} from "./dom/dom-operation-pipeline.js";
