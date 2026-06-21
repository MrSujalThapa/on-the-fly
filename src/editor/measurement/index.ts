export type {
  AlignmentEdge,
  MeasurementContext,
  MeasurementRect,
  ScanOptions,
  VisualNodeBuildResult,
} from "./types.js";

export {
  CONTAINER_TAG_NAMES,
  DEFAULT_ALIGNMENT_TOLERANCE_PX,
  EXCLUDED_TAG_NAMES,
  GIANT_NODE_AREA_RATIO,
  MAX_TEXT_FINGERPRINT_LENGTH,
  MIN_VISIBLE_SIZE_PX,
  OTF_ROOT_HOST_ATTR,
  OTF_ROOT_HOST_ID,
  OTF_ROOT_HOST_VALUE,
  SUBTREE_SKIP_TAG_NAMES,
  TEXT_LIKE_TAG_NAMES,
} from "./constants.js";

export {
  areEdgesAligned,
  containsRect,
  overlapArea,
  rectArea,
  rectCenter,
  rectDistance,
  rectsOverlap,
} from "./geometry.js";

export {
  extractBoundingBox,
  isZeroSizeRect,
  normalizeRect,
  rectToVisualNodeRect,
} from "./bounding-box.js";

export { snapshotComputedStyles } from "./computed-styles.js";

export { filterVisibleElements, isElementVisible } from "./visibility.js";

export {
  detectElementKind,
  isLikelyContainer,
} from "./element-kind.js";

export {
  getViewportAreaRatio,
  isExcludedTagName,
  isExtensionRoot,
  isGiantPageWrapper,
  shouldExcludeFromMeasurement,
  shouldSkipSubtree,
} from "./scan-guards.js";

export {
  buildBoundingBoxHint,
  buildCssPath,
  buildElementSignature,
  buildParentFingerprint,
  buildTextFingerprint,
} from "./signature-builder.js";

export {
  buildVisualNodeFromElement,
  createMeasurementContext,
  createVisualNodeId,
} from "./visual-node-builder.js";

export {
  buildVisualNodeMapFromElements,
  scanVisualNodes,
} from "./dom-scanner.js";
