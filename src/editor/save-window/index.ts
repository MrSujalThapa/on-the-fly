export {
  SAVE_WINDOW_DRAG_THRESHOLD_PX,
  SAVE_WINDOW_INTERSECTION_THRESHOLD,
  SAVE_WINDOW_MIN_RECT_PX,
} from "./constants.js";
export {
  classifyOperationForSaveWindow,
  classifyOperationsForSaveWindow,
  selectOperationsToKeep,
  selectOperationsToRevert,
  type ClassifiedOperation,
  type ClassifyOperationsOptions,
  type SaveWindowClassification,
  type SaveWindowClassificationSummary,
  type SaveWindowDisposition,
} from "./classify-operations.js";
export {
  buildMetadataFromElement,
  buildMetadataFromTransformTarget,
  measurementRectToAffectedRect,
  withOperationMetadata,
} from "./operation-metadata.js";
export {
  classifyRectAgainstWindow,
  isPointInsideRect,
  type SaveWindowRectDisposition,
} from "./rect-classification.js";
export {
  resolveOperationAffectedRect,
  type OperationRectResolution,
} from "./resolve-operation-rect.js";
