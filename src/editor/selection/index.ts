export type { SelectionResolveResult, LassoResolveOptions, ClickResolveOptions } from "./selection-resolver.js";
export {
  resolveClickSelection,
  resolveLassoSelection,
} from "./selection-resolver.js";

export {
  buildRectangleSampleGrid,
  getFilteredElementsFromPoint,
  isSelectableLassoSampleElement,
  isVisibleEnoughForLassoSample,
  mapSampledElementToVisualNode,
  MAX_RECT_SAMPLE_COUNT,
  MIN_RECT_SAMPLE_COUNT,
  RECT_SAMPLE_INSET_PX,
  RECT_SAMPLE_SPACING_PX,
} from "./rectangle-sampling.js";

export {
  buildDomSelectionTarget,
  collectRectangleSampleElements,
  containerUsefulnessScore,
  isUsefulContainer,
  resolveRectangleDomElements,
  scoreRectangleCandidate,
  ANCESTOR_WALK_LIMIT,
  MAX_CONTAINER_TO_RECT_RATIO,
  MAX_CONTAINER_VIEWPORT_RATIO,
  MAX_SELECTED_CONTAINERS,
  MIN_RECT_OVERLAP_RECT,
  MIN_RECT_OVERLAP_SELF,
  SECONDARY_SCORE_RATIO,
  WHOLE_PAGE_UNION_RATIO,
  type DomRectangleResult,
  type DomRectangleStats,
} from "./dom-rectangle-selection.js";

export {
  MAX_LASSO_SELECTION_RATIO,
  MAX_LASSO_VIEWPORT_COVERAGE,
  filterInteractiveNodes,
  isBlockedSelectionNode,
  isSelectableForInteraction,
  isWholePageLassoRect,
  isWholePageSelection,
} from "./selection-guards.js";

export {
  findAnchorInComposedPath,
  findDirectClickableInComposedPath,
  resolveClickTargetFromElementsFromPoint,
  resolveClickTargetNode,
  resolveVisualNodeForAnchor,
  resolveVisualNodeForElement,
  shouldSkipContainerPromotion,
} from "./dom-target-matching.js";

export {
  findNodesAtPoint,
  pickDeepestNodeAtPoint,
  toggleNodeId,
} from "./point-queries.js";

export {
  beginPointerGesture,
  getEventComposedPath,
  isExtensionRootInComposedPath,
  isLassoGesture,
  LASSO_DRAG_THRESHOLD_PX,
  MIN_LASSO_RECT_PX,
  normalizeLassoRect,
  resolvePointerGestureAction,
  shouldConsumeEditModePointerEvent,
  shouldHandleEditModeClickEvent,
  shouldHandleEditModePointerEvent,
  shouldSuppressEditModeClick,
  suppressPageInteractionEvent,
  updatePointerGesture,
} from "./pointer-interaction.js";

export {
  SelectionController,
  createSelectionController,
} from "./selection-controller.js";

export {
  computeUnionRect,
  createGroupId,
  createVirtualGroup,
  isGroupableMember,
  memberToVisualNode,
  recomputeGroupRect,
  toGroupMember,
  MIN_GROUP_MEMBERS,
  type CreateVirtualGroupOptions,
  type GroupMemberSource,
  type GroupSource,
  type VirtualGroup,
  type VirtualGroupMember,
} from "./virtual-group.js";
