export type {
  DomInvalidationListenerOptions,
  GeometryCacheOptions,
  GeometryCacheState,
  GraphQueryOptions,
  InvalidationReason,
  InvalidationSchedulerOptions,
  MeasurementRectInput,
  RectQueryOptions,
  VisualLayoutGraphSnapshot,
  CancelFn,
  ScheduleFn,
} from "./types.js";

export {
  filterSelectableNodes,
  findNearestContainer,
  findNearestParent,
  findNodesInRect,
  getNodeById,
  isSelectableNode,
} from "./graph-queries.js";

export { VisualLayoutGraph } from "./visual-layout-graph.js";

export {
  GeometryCache,
  createGeometryCache,
} from "./geometry-cache.js";

export {
  InvalidationScheduler,
  createInvalidationScheduler,
  resolvePrimaryInvalidationReason,
} from "./invalidation-scheduler.js";

export type {
  GeometryCacheBundle,
  GeometryCacheController,
} from "./dom-invalidation-listener.js";

export {
  attachDomInvalidationListeners,
  createGeometryCacheBundle,
  createGeometryCacheController,
} from "./dom-invalidation-listener.js";

export {
  CARD_CONTAINER_SCORE_THRESHOLD,
  enrichNodeContainerMetadata,
  findBestCardContainerAncestor,
  getNodeChildren,
  isLikelyCardContainer,
  isPageWrapperNode,
  promoteSelectionTarget,
  scoreContainerLikelihood,
  shouldPromoteChildToContainer,
} from "./container-detection.js";
