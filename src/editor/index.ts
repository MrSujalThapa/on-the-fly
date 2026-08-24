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
  CommandShortcut,
  EditorCommand,
} from "./editor-command.js";

export type {
  CropOperation,
  EditorOperation,
  EditorOperationType,
  GroupOperation,
  HelperObjectBorder,
  HelperObjectBoxShadow,
  HelperObjectFill,
  HelperObjectRect,
  HelperObjectRole,
  HideOperation,
  InsertHelperObjectOperation,
  InsertImageOperation,
  CreateElementOperation,
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

export type { GroupState } from "./group-state.js";

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
  OperationValidationError,
  validateOperation,
  validateOperations,
} from "./validation/validate-operation.js";
export {
  validateOperationForDom,
  validateOperationsForDom,
} from "./validation/validate-dom-operation.js";
export {
  validateUnknownOperation,
  validateUnknownOperations,
} from "./validation/validate-unknown-operation.js";
export {
  AGENT_OPERATION_TYPES,
  validateAgentOperation,
  validateAgentOperations,
} from "./validation/validate-agent-operation.js";
export type {
  OperationValidationFailure,
  OperationValidationResult,
  OperationValidationSuccess,
} from "./validation/operation-validation-result.js";
export type { DomErrorCode, SupportedDomOperationType, ValidationErrorCode } from "./validation/validation-codes.js";
export {
  inferValidationErrorCodes,
  isSupportedDomOperationType,
  SUPPORTED_DOM_OPERATION_TYPES,
} from "./validation/validation-codes.js";

export {
  CommandRegistry,
  createCommandRegistry,
  findCommandForKeyboardEvent,
  matchCommandShortcut,
  commandAppliesToSelection,
  hasActiveSelection,
  isSingleHandleTarget,
  isSingleTextLikeSelection,
  resolveSelectionTags,
  type ResolvedCommand,
} from "./commands/index.js";

export type {
  AppliedDomEffect,
  DomApplyFailure,
  DomApplyResult,
  DomApplySuccess,
  DomChange,
  ElementStyleSnapshot,
  MatchViewport,
  StoredTransformState,
} from "./dom/types.js";
export {
  OTF_MANAGED_ATTR,
  OTF_TRANSFORM_ATTR,
  createDomApplyFailure,
  createDomApplySuccess,
} from "./dom/types.js";
export { ElementSnapshotStore, captureElementSnapshot } from "./dom/element-snapshot.js";
export { matchElementBySignature, getMatchViewport } from "./dom/signature-matcher.js";
export { resolveTargetElement } from "./dom/resolve-target.js";
export { DomRuntimeAdapter, createDomRuntimeAdapter } from "./dom/dom-runtime-adapter.js";

export type {
  AlignmentEdge,
  MeasurementContext,
  MeasurementRect,
  ScanOptions,
  VisualNodeBuildResult,
} from "./measurement/index.js";
export {
  areEdgesAligned,
  buildBoundingBoxHint,
  buildCssPath,
  buildElementSignature,
  buildTextFingerprint,
  buildVisualNodeFromElement,
  buildVisualNodeMapFromElements,
  containsRect,
  createMeasurementContext,
  createVisualNodeId,
  detectElementKind,
  extractBoundingBox,
  filterVisibleElements,
  isElementVisible,
  isExcludedTagName,
  isExtensionRoot,
  isGiantPageWrapper,
  isLikelyContainer,
  isZeroSizeRect,
  overlapArea,
  rectArea,
  rectCenter,
  rectDistance,
  rectsOverlap,
  scanVisualNodes,
  shouldExcludeFromMeasurement,
  shouldSkipSubtree,
  snapshotComputedStyles,
} from "./measurement/index.js";

export type {
  CancelFn,
  DomInvalidationListenerOptions,
  GeometryCacheOptions,
  GeometryCacheState,
  GraphQueryOptions,
  InvalidationReason,
  InvalidationSchedulerOptions,
  RectQueryOptions,
  ScheduleFn,
  VisualLayoutGraphSnapshot,
} from "./visual-graph/index.js";
export {
  GeometryCache,
  InvalidationScheduler,
  VisualLayoutGraph,
  attachDomInvalidationListeners,
  createGeometryCache,
  createGeometryCacheBundle,
  createGeometryCacheController,
  createInvalidationScheduler,
  filterSelectableNodes,
  findNearestContainer,
  findNearestParent,
  findNodesInRect,
  getNodeById,
  isSelectableNode,
  resolvePrimaryInvalidationReason,
} from "./visual-graph/index.js";

export type {
  SelectionResolveResult,
  LassoResolveOptions,
  DomRectangleResult,
  DomRectangleStats,
  CreateVirtualGroupOptions,
  GroupMemberSource,
  GroupSource,
  VirtualGroup,
  VirtualGroupMember,
} from "./selection/index.js";
export type {
  BuildOperationOptions,
  LayerCommand,
  Point,
  ResizeHandleId,
  ResizePayloadInput,
  ResizeResult,
  TransformTarget,
} from "./transform/index.js";
export {
  angleForPointer,
  BACK_LAYER,
  buildMoveOperation,
  buildMoveOperations,
  buildResizeOperation,
  buildRotateOperation,
  buildStyleOperation,
  buildStyleOperations,
  buildTextOperation,
  buildZIndexOperation,
  computeNextLayer,
  computeResize,
  createOperationId,
  FRONT_LAYER,
  isResizeHandleId,
  LAYER_STEP,
  MIN_RESIZE_SIZE_PX,
  normalizeDegrees,
  parseLayer,
  rectCenterPoint,
  RESIZE_HANDLE_IDS,
  snapDegrees,
  toTransformTarget,
  toTransformTargets,
  transformTargetToEditorTarget,
} from "./transform/index.js";

export {
  SelectionController,
  buildDomSelectionTarget,
  buildRectangleSampleGrid,
  computeUnionRect,
  createGroupId,
  createSelectionController,
  createVirtualGroup,
  isGroupableMember,
  memberToVisualNode,
  recomputeGroupRect,
  toGroupMember,
  filterInteractiveNodes,
  findAnchorInComposedPath,
  findNodesAtPoint,
  getEventComposedPath,
  getFilteredElementsFromPoint,
  isBlockedSelectionNode,
  isLassoGesture,
  isSelectableForInteraction,
  isSelectableLassoSampleElement,
  isUsefulContainer,
  isWholePageLassoRect,
  isWholePageSelection,
  LASSO_DRAG_THRESHOLD_PX,
  mapSampledElementToVisualNode,
  MIN_LASSO_RECT_PX,
  normalizeLassoRect,
  pickDeepestNodeAtPoint,
  resolveClickSelection,
  resolveClickTargetNode,
  resolveLassoSelection,
  resolveRectangleDomElements,
  resolveVisualNodeForAnchor,
  shouldConsumeEditModePointerEvent,
  shouldSkipContainerPromotion,
  suppressPageInteractionEvent,
  toggleNodeId,
} from "./selection/index.js";
