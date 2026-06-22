export type { TransformTarget } from "./transform-target.js";
export {
  toTransformTarget,
  toTransformTargets,
  transformTargetToEditorTarget,
} from "./transform-target.js";

export { createOperationId } from "./operation-id.js";

export type { BuildOperationOptions, ResizePayloadInput } from "./operation-factory.js";
export {
  buildMoveOperation,
  buildMoveOperations,
  buildResizeOperation,
  buildRotateOperation,
  buildZIndexOperation,
} from "./operation-factory.js";

export type { LayerCommand } from "./layer-order.js";
export {
  BACK_LAYER,
  computeNextLayer,
  FRONT_LAYER,
  LAYER_STEP,
  MANAGED_Z_INDEX_BASELINE,
  parseLayer,
  resolveCurrentManagedLayer,
} from "./layer-order.js";

export type { ResizeHandleId, ResizeResult } from "./resize-geometry.js";
export {
  computeResize,
  isResizeHandleId,
  MIN_RESIZE_SIZE_PX,
  RESIZE_HANDLE_IDS,
} from "./resize-geometry.js";

export type { Point } from "./rotate-geometry.js";
export {
  angleForPointer,
  normalizeDegrees,
  rectCenterPoint,
  snapDegrees,
} from "./rotate-geometry.js";
