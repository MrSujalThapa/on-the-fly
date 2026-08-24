import type { CropOperation, DuplicateOperation, EditorOperation, MoveOperation, ResizeOperation, StyleProperty, ZIndexOperation } from "../editor/operations.js";
import type { GroupId, VisualNodeId } from "../editor/ids.js";
import { computeDocumentPageKey } from "../content/page-identity.js";
import {
  loadPageOperations,
  replacePageOperations,
} from "../content/storage-client.js";
import { waitForDocumentReady, waitForReplayTargets } from "../editor/dom/replay-readiness.js";
import { OTF_TRANSFORM_ATTR, type StoredTransformState } from "../editor/dom/types.js";
import { readStoredCropInsets, resolveCropSubject } from "../editor/dom/handlers/crop-handler.js";
import { renderedVisibleText } from "../editor/dom/handlers/text-handler.js";
import { textSubtreeStyleTargets } from "../editor/dom/handlers/style-handler.js";
import { isFillStyleProperty, resolveFillSurface, resolveStyleRealizationTarget, setManagedStyleProperty } from "../editor/style/fill-surface.js";
import { captureElementDomSnapshot, restoreElementDomSnapshot, type ElementDomSnapshot } from "../editor/dom/dom-placement-snapshot.js";
import { isExtensionRoot } from "../editor/measurement/scan-guards.js";
import { createInputRouter } from "./create-input-router.js";
import { createOperationExecutor } from "./create-operation-executor.js";
import { createOperationLedger } from "./create-operation-ledger.js";
import { createOverlayCoordinator } from "./create-overlay-coordinator.js";
import { createPlacementEngine } from "./create-placement-engine.js";
import { createVisualModel } from "./create-visual-model.js";
import { DisposableOwner } from "./disposable-owner.js";
import type { EditorRuntime, PersistResult, ReplayResult } from "./editor-runtime.js";
import type { NormalizedPointer } from "./input-router.js";
import { rectFromElement, rectsNear } from "./geometry.js";
import type { BatchExecutionResult, ExecutionResult } from "./operation-executor.js";
import type { IntendedRect } from "./placement-engine.js";
import { identityConsistent, summarizeIdentity } from "./visual-identity.js";
import { isResolvedVisual } from "./visual-model.js";
import { projectCanonicalCheckpoint } from "./canonical-checkpoint.js";
import { buildDuplicateFromClipboardEntry } from "../editor/duplicate/duplicate-element.js";
import { buildCropOperation, buildHideOperation, buildMoveOperation, buildResizeOperation, buildRotateOperation, buildStyleOperation, buildTextOperation } from "../editor/transform/operation-factory.js";
import { applyStoredTransformState, applyStoredTransformStateToRect, readStoredTransformState, writeStoredTransformState } from "../editor/dom/element-snapshot.js";
import { localSizeForRotatedBounds, resizeRectFromCorner, rotatePointAroundCenter, rotatedMemberRect, scaleRects, type ResizeCorner } from "./editor-parity-geometry.js";
import {
  buildLassoSampleGrid,
  LASSO_THRESHOLD_PX,
  meaningfullyIntersects,
  normalizeRect,
} from "./lasso-selection.js";
import {
  buildInsidePolygonSamples,
  isMeaningfulFreeform,
  polygonQualifiesRect,
  shouldAppendFreeformPoint,
  simplifyPolygon,
  type Point,
} from "./polygon-geometry.js";
import {
  emptySelection,
  flattenSelection,
  normalizeSelection,
  selectionFromAtoms,
  toggleAtom,
  unionRects,
  type RuntimeSelection,
  type RuntimeVirtualGroup,
  type SelectionAtom,
} from "./runtime-selection.js";

const MOVE_THRESHOLD_PX = 3;
const STYLE_CSS_MAP: Record<StyleProperty, string> = {
  color: "color", backgroundColor: "background-color", backgroundImage: "background-image",
  borderColor: "border-color", borderWidth: "border-width", borderRadius: "border-radius",
  fontSize: "font-size", fontWeight: "font-weight", textAlign: "text-align", opacity: "opacity",
  boxShadow: "box-shadow", filter: "filter",
};
const TEXT_STYLE_PROPERTIES = new Set<StyleProperty>(["color", "fontSize", "fontWeight", "textAlign"]);

function exclusiveFillStyles(styles: ReadonlyMap<StyleProperty, string>): Map<StyleProperty, string> {
  const next = new Map(styles);
  if (!next.has("backgroundColor")) return next;
  const image = next.get("backgroundImage")?.trim() ?? "";
  if (image !== "" && image !== "none") return next;
  next.set("backgroundImage", "none");
  return next;
}

interface PreviewTarget {
  nodeId: VisualNodeId;
  element: HTMLElement;
  startPointer: { x: number; y: number };
  startRect: IntendedRect;
  styleSnapshot: string | null;
  committedTransform: string;
}

interface MovingGesture {
  kind: "move";
  startPointer: { x: number; y: number };
  targets: readonly PreviewTarget[];
  clickPick: VisualNodeId | null;
}

interface LassoGesture {
  kind: "lasso";
  startPointer: { x: number; y: number };
  shiftKey: boolean;
  picked: VisualNodeId | null;
  active: boolean;
}

interface FreeformLassoGesture {
  kind: "freeform";
  pointerId: number;
  startPointer: { x: number; y: number };
  points: Point[];
  additive: boolean;
}

type PointerGesture = MovingGesture | LassoGesture | FreeformLassoGesture;
type ArmedLassoMode = "rectangle" | "freeform" | null;

interface TransformPreviewTarget {
  nodeId: VisualNodeId;
  element: HTMLElement;
  snapshot: ElementDomSnapshot;
  startRect: IntendedRect;
  startState: StoredTransformState;
  localSize: { width: number; height: number };
}

interface TransformGesture {
  id: string;
  kind: "resize-nw" | "resize-ne" | "resize-sw" | "resize-se" | "rotate" | "crop-nw" | "crop-ne" | "crop-sw" | "crop-se";
  startPointer: { x: number; y: number };
  startUnion: IntendedRect;
  targets: readonly TransformPreviewTarget[];
  lastPointer: { x: number; y: number };
  rafId: number;
  cropInsets?: CropOperation["payload"];
}

interface ClipboardSnapshot {
  copiedAt: number;
  items: readonly DuplicateOperation[];
  groupPartitions: readonly (readonly number[])[];
}

function isMoveOperation(value: { type: string }): value is MoveOperation {
  return value.type === "move";
}

function isLayerOperation(value: { type: string }): value is ZIndexOperation {
  return value.type === "zIndex";
}

function logV2(event: string, details?: Record<string, unknown>): void {
  if (typeof __OTF_DIAGNOSTICS_ENABLED__ !== "undefined" && __OTF_DIAGNOSTICS_ENABLED__) {
    console.info(`[otf-v2] ${event}`, details ?? {});
  }
}

export function createEditorRuntime(root: Document): EditorRuntime {
  const visualModel = createVisualModel(root);
  const placement = createPlacementEngine();
  const ledger = createOperationLedger();
  const executor = createOperationExecutor({
    document: root,
    visualModel,
    ledger,
    placement,
  });
  const overlays = createOverlayCoordinator({ document: root, visualModel });
  const input = createInputRouter(root);

  const ownerHolder: { current: DisposableOwner } = { current: new DisposableOwner() };
  const owner = (): DisposableOwner => ownerHolder.current;
  let started = false;
  let selection: RuntimeSelection = emptySelection();
  let groups = new Map<GroupId, RuntimeVirtualGroup>();
  let groupByMember = new Map<VisualNodeId, GroupId>();
  let groupCounter = 0;
  let gesture: PointerGesture | null = null;
  let armedLassoMode: ArmedLassoMode = null;
  let transformGesture: TransformGesture | null = null;
  let ignoreMutations = false;
  const releaseMutationIgnore = (): void => {
    queueMicrotask(() => {
      ignoreMutations = false;
    });
  };
  let previousUserSelect = "";
  let resizeObserver: ResizeObserver | null = null;
  let saveInFlight: Promise<PersistResult> | null = null;
  let clipboard: ClipboardSnapshot | null = null;
  let pasteCounter = 0;
  const pastePartitions = new Map<string, readonly (readonly number[])[]>();
  let operationCounter = 0;
  let replayGeneration = 0;
  let saveStatus: "idle" | "saving" | "saved" | "failed" = "idle";
  let lastSaveError: string | undefined;
  let refreshToolbar = (): void => undefined;
  let stylePanelOpen = false;
  let textEditorOpen = false;
  let cropMode = false;
  let toolbarOpen = false;
  let stylePreview: {
    pending: Map<StyleProperty, string>;
    snapshots: Map<HTMLElement, string | null>;
    originals: Map<HTMLElement, Map<StyleProperty, string>>;
  } | null = null;

  const pageKey = (): string => computeDocumentPageKey(root);

  const refreshSave = (): void => {
    if (ledger.isDirty() && saveStatus === "saved") {
      saveStatus = "idle";
    }
    overlays.setSave({
      visible: ledger.isDirty() || saveStatus !== "idle",
      status: saveStatus,
      ...(lastSaveError ? { error: lastSaveError } : {}),
      onSave: () => {
        void runtime.save();
      },
    });
  };

  const applyUserSelect = (editOwned: boolean): void => {
    const html = root.documentElement;
    if (editOwned) {
      if (html.style.userSelect !== "none") {
        previousUserSelect = html.style.userSelect;
        html.style.userSelect = "none";
      }
      return;
    }
    html.style.userSelect = previousUserSelect;
  };

  const selectedIds = (): VisualNodeId[] => flattenSelection(selection, groups);

  const nextOperationId = (kind: string): string => {
    operationCounter += 1;
    return `otf-${kind}-${Date.now().toString(36)}-${operationCounter.toString(36)}`;
  };

  const transactionKey = (operations: readonly EditorOperation[]): string => operations.map((operation) => operation.id).join("|");

  const removeGroupsContaining = (memberIds: ReadonlySet<VisualNodeId>): void => {
    groups = new Map([...groups].filter(([, group]) => !group.memberIds.some((id) => memberIds.has(id))));
    groupByMember = new Map([...groups].flatMap(([groupId, group]) => group.memberIds.map((id) => [id, groupId] as const)));
  };

  const restorePasteGroups = (cloneIds: readonly VisualNodeId[], partitions: readonly (readonly number[])[]): SelectionAtom[] => {
    const atoms: SelectionAtom[] = cloneIds.map((nodeId) => ({ kind: "node", nodeId }));
    for (const partition of partitions) {
      const members = partition.map((index) => cloneIds[index]).filter((id): id is VisualNodeId => Boolean(id));
      if (members.length < 2) continue;
      const groupId: GroupId = `otf-group-${(++groupCounter).toString(36)}`;
      groups.set(groupId, { id: groupId, memberIds: members });
      for (const member of members) groupByMember.set(member, groupId);
      for (let index = atoms.length - 1; index >= 0; index -= 1) {
        const atom = atoms[index];
        if (atom?.kind === "node" && members.includes(atom.nodeId)) atoms.splice(index, 1);
      }
      atoms.push({ kind: "group", groupId });
    }
    return atoms;
  };

  const observeSelected = (): void => {
    resizeObserver?.disconnect();
    if (!root.defaultView) return;
    resizeObserver = new ResizeObserver(() => {
      overlays.refreshFromLiveGeometry();
    });
    for (const nodeId of selectedIds()) {
      const element = visualModel.bind(nodeId);
      if (element) resizeObserver.observe(element);
    }
  };

  const renderSelection = (): void => {
    const ids = selectedIds();
    if (ids.length > 0) {
      const explicitGroup = selection.atoms.length === 1 && selection.atoms[0]?.kind === "group";
      overlays.showSelection(ids, explicitGroup ? "group" : "selection");
    }
    else overlays.clear();
    observeSelected();
    refreshToolbar();
  };

  const setSelection = (next: RuntimeSelection): void => {
    if (stylePanelOpen) { cancelStylePreview(); stylePanelOpen = false; overlays.closeStylePanel(); }
    if (textEditorOpen) { textEditorOpen = false; overlays.closeTextEditor(true); }
    cropMode = false;
    overlays.setCropMode(false);
    selection = normalizeSelection(next.atoms, groups, next.source);
    if (selection.atoms.length === 0) toolbarOpen = false;
    overlays.setToolbarVisible(toolbarOpen);
    renderSelection();
  };

  const atomForNode = (nodeId: VisualNodeId): SelectionAtom => {
    const groupId = groupByMember.get(nodeId);
    return groupId ? { kind: "group", groupId } : { kind: "node", nodeId };
  };

  const resolveLasso = (rect: IntendedRect): VisualNodeId[] => {
    const seenElements = new Set<HTMLElement>();
    const seenIds = new Set<VisualNodeId>();
    const ids: VisualNodeId[] = [];
    for (const point of buildLassoSampleGrid(rect)) {
      for (const candidate of root.elementsFromPoint(point.x, point.y)) {
        if (!(candidate instanceof HTMLElement) || seenElements.has(candidate) || isExtensionRoot(candidate)) continue;
        seenElements.add(candidate);
        const nodeId = visualModel.adopt(candidate);
        const node = nodeId ? visualModel.get(nodeId) : null;
        if (!nodeId || !node?.capabilities.movable || seenIds.has(nodeId)) continue;
        const measured = visualModel.measure([nodeId]).get(nodeId);
        if (!measured || measured.width <= 1 || measured.height <= 1 || !meaningfullyIntersects(measured, rect)) continue;
        seenIds.add(nodeId);
        ids.push(nodeId);
      }
    }
    return ids;
  };

  const resolveFreeform = (polygon: readonly Point[]): VisualNodeId[] => {
    const seenElements = new Set<HTMLElement>();
    const seenIds = new Set<VisualNodeId>();
    const ids: VisualNodeId[] = [];
    const samples = buildInsidePolygonSamples(polygon);
    for (const point of samples) {
      for (const candidate of root.elementsFromPoint(point.x, point.y)) {
        if (!(candidate instanceof HTMLElement) || seenElements.has(candidate) || isExtensionRoot(candidate)) continue;
        seenElements.add(candidate);
        const nodeId = visualModel.adopt(candidate);
        const node = nodeId ? visualModel.get(nodeId) : null;
        if (!nodeId || !node?.capabilities.movable || seenIds.has(nodeId)) continue;
        const measured = visualModel.measure([nodeId]).get(nodeId);
        if (!measured || measured.width <= 1 || measured.height <= 1 || !polygonQualifiesRect(polygon, measured)) continue;
        seenIds.add(nodeId);
        ids.push(nodeId);
      }
    }
    return dropNestedAncestors(ids);
  };

  const dropNestedAncestors = (ids: readonly VisualNodeId[]): VisualNodeId[] => {
    const bound = ids
      .map((id) => ({ id, element: visualModel.bind(id) }))
      .filter((entry): entry is { id: VisualNodeId; element: HTMLElement } => Boolean(entry.element));
    return bound
      .filter((entry) => !bound.some((other) => other.element !== entry.element && entry.element.contains(other.element)))
      .map((entry) => entry.id);
  };

  const reapplyActive = (): void => {
    const checkpoint = projectCanonicalCheckpoint(ledger.activeOperations());
    if (!checkpoint.ok) {
      logV2("reapply-checkpoint-failed", { owner: "LEDGER", error: checkpoint.error });
      return;
    }
    ignoreMutations = true;
    try {
      for (const operation of checkpoint.operations) {
        if (!["move", "resize", "rotate", "zIndex", "hide", "style", "text", "crop"].includes(operation.type)) {
          continue;
        }
        const identity = operation.target.signature
          ? { signature: operation.target.signature }
          : null;
        if (!identity) {
          continue;
        }
        const cached = operation.target.nodeId
          ? visualModel.resolveNode(operation.target.nodeId)
          : null;
        const resolved = cached && isResolvedVisual(cached) && identityConsistent(cached.element, identity)
          ? cached
          : visualModel.resolveIdentity(identity);
        if (!isResolvedVisual(resolved)) {
          logV2("reapply-identity", {
            owner: "IDENTITY",
            id: operation.id,
            kind: resolved.kind,
            evidence: resolved.evidence,
          });
          continue;
        }
        const reboundOperation = resolved.nodeId
          ? { ...operation, target: { ...operation.target, nodeId: resolved.nodeId } } as EditorOperation
          : operation;
        if (isLayerOperation(operation)) {
          executor.replayLayer(reboundOperation as ZIndexOperation);
          continue;
        }
        if (!isMoveOperation(operation)) {
          const result = executor.reconcileOperation(reboundOperation);
          logV2("reapply", { owner: "EXECUTION", ok: result.ok, id: operation.id, error: result.ok ? undefined : result.error });
          continue;
        }
        const expected = operation.metadata?.finalRect;
        if (expected && rectsNear(rectFromElement(resolved.element), expected)) {
          if (resolved.nodeId) {
            visualModel.cache(resolved.nodeId, resolved.element);
          }
          continue;
        }
        if (resolved.element.getAttribute(OTF_TRANSFORM_ATTR)) {
          if (resolved.nodeId) {
            visualModel.cache(resolved.nodeId, resolved.element);
          }
          continue;
        }
        const result = executor.replayMove(reboundOperation as MoveOperation);
        logV2("reapply", {
          owner: result.ok ? "EXECUTION" : "EXECUTION",
          ok: result.ok,
          id: operation.id,
          error: result.ok ? undefined : result.error,
        });
      }
      for (const move of checkpoint.operations.filter(isMoveOperation)) {
        const expected = move.metadata?.finalRect;
        if (!expected || !move.target.signature) continue;
        const resolved = visualModel.resolveIdentity({ signature: move.target.signature });
        if (!isResolvedVisual(resolved)) continue;
        const current = rectFromElement(resolved.element);
        if (rectsNear(current, expected)) continue;
        executor.replayMove({
          ...move,
          target: { ...move.target, ...(resolved.nodeId ? { nodeId: resolved.nodeId } : {}) },
          payload: { ...move.payload, dx: expected.x - current.x, dy: expected.y - current.y },
        });
      }
    } finally {
      releaseMutationIgnore();
    }
    renderSelection();
  };

  const restorePreview = (): void => {
    if (!gesture || gesture.kind !== "move") return;
    for (const target of gesture.targets) {
      if (!target.element.isConnected) continue;
      if (target.styleSnapshot) target.element.setAttribute("style", target.styleSnapshot);
      else target.element.removeAttribute("style");
    }
  };

  const applyPreview = (dx: number, dy: number): void => {
    if (!gesture || gesture.kind !== "move") return;
    restorePreview();
    const extra = `translate(${String(dx)}px, ${String(dy)}px)`;
    for (const target of gesture.targets) {
      target.element.style.transform = target.committedTransform
        ? `${target.committedTransform} ${extra}`
        : extra;
    }
  };

  const cancelGesture = (): void => {
    restorePreview();
    gesture = null;
    armedLassoMode = null;
    overlays.clearLasso();
    overlays.refreshFromLiveGeometry();
    refreshToolbar();
  };

  const effectRoots = (nodeIds: readonly VisualNodeId[]): VisualNodeId[] => {
    if (new Set(nodeIds).size !== nodeIds.length) return [];
    const selectedSet = new Set(nodeIds);
    return nodeIds.filter((nodeId) => {
      const element = visualModel.bind(nodeId);
      if (!element || placement.isIndependent(element)) return true;
      let parentId = visualModel.parentOf(nodeId);
      while (parentId) {
        if (selectedSet.has(parentId)) return false;
        parentId = visualModel.parentOf(parentId);
      }
      return true;
    });
  };

  const singleSelectedElement = (): { nodeId: VisualNodeId; element: HTMLElement } | null => {
    const ids = selectedIds();
    if (ids.length !== 1) return null;
    const nodeId = ids[0];
    const element = nodeId ? visualModel.bind(nodeId) : null;
    return nodeId && element ? { nodeId, element } : null;
  };

  const textSurface = (element: HTMLElement): HTMLElement | null => {
    const full = renderedVisibleText(element);
    if (!full) return null;
    const hasUnsafeMedia = Boolean(element.querySelector("img, video, input, textarea, select, [contenteditable=true]"));
    if (element.matches("p, span, button, a, label, h1, h2, h3, h4, h5, h6, li") && !hasUnsafeMedia) return element;
    if (element.childElementCount === 0) return element;
    if (
      element.tagName === "DIV" &&
      !hasUnsafeMedia &&
      !element.querySelector("p, button, a, label, h1, h2, h3, h4, h5, h6, li, article, section, ul, ol")
    ) {
      return element;
    }
    const candidates = Array.from(element.querySelectorAll<HTMLElement>("p, span, button, a, label, h1, h2, h3, h4, h5, h6, li"))
      .filter((candidate) => renderedVisibleText(candidate) === full && !candidate.querySelector("img, video, input, textarea, select"))
      .filter((candidate) => !Array.from(candidate.children).some((child) => child.matches("p, button, a, label, h1, h2, h3, h4, h5, h6, li")));
    return candidates.length === 1 ? candidates[0] ?? null : null;
  };

  const canEditText = (element: HTMLElement): boolean => Boolean(textSurface(element));
  const canCrop = (element: HTMLElement): boolean => {
    const subject = resolveCropSubject(element);
    return Boolean(subject && (readStoredTransformState(subject)?.rotate ?? 0) === 0);
  };

  const restoreStylePreview = (): void => {
    if (!stylePreview) return;
    ignoreMutations = true;
    for (const [element, style] of stylePreview.snapshots) {
      if (!element.isConnected) continue;
      if (style === null) element.removeAttribute("style");
      else element.setAttribute("style", style);
    }
  };

  const cancelStylePreview = (): void => {
    restoreStylePreview();
    stylePreview = null;
    releaseMutationIgnore();
    overlays.refreshFromLiveGeometry();
  };

  const previewStyle = (property: StyleProperty, value: string): void => {
    const ids = effectRoots(selectedIds());
    const targets = ids.map((id) => visualModel.bind(id)).filter((element): element is HTMLElement => Boolean(element));
    if (targets.length !== ids.length || targets.length === 0) return;
    if (!stylePreview) stylePreview = { pending: new Map(), snapshots: new Map(), originals: new Map() };
    ignoreMutations = true;
    restoreStylePreview();
    stylePreview.pending.set(property, value);
    if (property === "backgroundColor") stylePreview.pending.set("backgroundImage", "none");
    for (const element of targets) {
      if (!stylePreview.snapshots.has(element)) stylePreview.snapshots.set(element, element.getAttribute("style"));
      let originals = stylePreview.originals.get(element);
      if (!originals) { originals = new Map(); stylePreview.originals.set(element, originals); }
      const originalSource = resolveStyleRealizationTarget(element, property);
      if (!originals.has(property)) originals.set(property, getComputedStyle(originalSource).getPropertyValue(STYLE_CSS_MAP[property]));
      for (const [pendingProperty, pendingValue] of stylePreview.pending) {
        const wantsSubtree = TEXT_STYLE_PROPERTIES.has(pendingProperty) && textSurface(element) !== element;
        const subtree = wantsSubtree ? textSubtreeStyleTargets(element) : [];
        const fillSurface = isFillStyleProperty(pendingProperty) ? resolveFillSurface(element) : element;
        const styleTargets = wantsSubtree && subtree.length > 0 ? subtree : wantsSubtree ? [] : [fillSurface];
        for (const styleTarget of styleTargets) {
          if (!stylePreview.snapshots.has(styleTarget)) stylePreview.snapshots.set(styleTarget, styleTarget.getAttribute("style"));
          if (isFillStyleProperty(pendingProperty)) setManagedStyleProperty(styleTarget, STYLE_CSS_MAP[pendingProperty], pendingValue);
          else styleTarget.style.setProperty(STYLE_CSS_MAP[pendingProperty], pendingValue);
        }
      }
    }
    overlays.refreshFromLiveGeometry();
  };

  const stylePanelValues = (): Record<string, string> => {
    const selected = singleSelectedElement();
    if (!selected) return {};
    const fillSurface = resolveFillSurface(selected.element);
    return Object.fromEntries(Object.entries(STYLE_CSS_MAP).map(([property, css]) => {
      const source = isFillStyleProperty(property as StyleProperty) ? fillSurface : selected.element;
      return [property, getComputedStyle(source).getPropertyValue(css).trim()];
    }));
  };

  refreshToolbar = (): void => {
    const selected = singleSelectedElement();
    const hasSelection = selectedIds().length > 0;
    overlays.setToolbarCommands([
      { id: "crop-mode", enabled: Boolean(selected && canCrop(selected.element)) },
      { id: "style-panel", enabled: hasSelection },
      { id: "agent", enabled: false },
      { id: "text-edit", enabled: Boolean(selected && canEditText(selected.element)) },
      { id: "lasso", enabled: true },
      { id: "undo", enabled: ledger.canUndo() },
      { id: "redo", enabled: ledger.canRedo() },
      { id: "more", enabled: false },
    ], { "crop-mode": cropMode, "style-panel": stylePanelOpen, "text-edit": textEditorOpen, "lasso": armedLassoMode !== null });
  };

  const initialTransformState = (element: HTMLElement): StoredTransformState => {
    const stored = readStoredTransformState(element);
    if (stored) return { ...stored };
    const computed = getComputedStyle(element);
    return {
      dx: 0,
      dy: 0,
      width: null,
      height: null,
      rotate: 0,
      position: computed.position === "static" ? "relative" : computed.position,
    };
  };

  const restoreTransformPreview = (active = transformGesture): void => {
    if (!active) return;
    const view = root.defaultView;
    if (view && active.rafId !== 0) view.cancelAnimationFrame(active.rafId);
    active.rafId = 0;
    for (const target of active.targets) {
      restoreElementDomSnapshot(root, target.snapshot, target.element);
    }
  };

  const cropInsetsAt = (active: TransformGesture, pointer: { x: number; y: number }): CropOperation["payload"] => {
    const start = active.cropInsets ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const dx = pointer.x - active.startPointer.x;
    const dy = pointer.y - active.startPointer.y;
    const maxX = Math.max(0, active.startUnion.width - 1);
    const maxY = Math.max(0, active.startUnion.height - 1);
    const next = { ...start };
    if (active.kind.endsWith("nw") || active.kind.endsWith("sw")) next.left = Math.min(maxX - start.right, Math.max(0, start.left + dx));
    if (active.kind.endsWith("ne") || active.kind.endsWith("se")) next.right = Math.min(maxX - start.left, Math.max(0, start.right - dx));
    if (active.kind.endsWith("nw") || active.kind.endsWith("ne")) next.top = Math.min(maxY - start.bottom, Math.max(0, start.top + dy));
    if (active.kind.endsWith("sw") || active.kind.endsWith("se")) next.bottom = Math.min(maxY - start.top, Math.max(0, start.bottom - dy));
    return next;
  };

  const previewTransformAt = (active: TransformGesture, pointer: { x: number; y: number }): void => {
    restoreTransformPreview(active);
    if (active.targets.some((target) => !target.element.isConnected || visualModel.bind(target.nodeId) !== target.element)) return;
    if (active.kind.startsWith("crop-")) {
      const insets = cropInsetsAt(active, pointer);
      const clipPath = `inset(${String(insets.top)}px ${String(insets.right)}px ${String(insets.bottom)}px ${String(insets.left)}px)`;
      const target = active.targets[0]?.element;
      if (target) {
        target.style.clipPath = clipPath;
        target.style.setProperty("-webkit-clip-path", clipPath);
        target.setAttribute("data-otf-crop", JSON.stringify(insets));
      }
    } else if (active.kind === "rotate") {
      const center = { x: active.startUnion.x + active.startUnion.width / 2, y: active.startUnion.y + active.startUnion.height / 2 };
      const initial = Math.atan2(active.startPointer.y - center.y, active.startPointer.x - center.x);
      const current = Math.atan2(pointer.y - center.y, pointer.x - center.x);
      const degrees = (current - initial) * 180 / Math.PI;
      for (const target of active.targets) {
        const state = { ...target.startState, rotate: target.startState.rotate + degrees };
        writeStoredTransformState(target.element, state);
        applyStoredTransformState(target.element, state);
        const memberCenter = rotatePointAroundCenter({
          x: target.startRect.x + target.startRect.width / 2,
          y: target.startRect.y + target.startRect.height / 2,
        }, center, degrees);
        const rotated = target.element.getBoundingClientRect();
        applyStoredTransformStateToRect(target.element, state, {
          x: memberCenter.x - rotated.width / 2,
          y: memberCenter.y - rotated.height / 2,
          width: target.localSize.width,
          height: target.localSize.height,
        });
      }
    } else {
      const targetUnion = resizeRectFromCorner(
        active.startUnion,
        active.kind.slice(-2) as ResizeCorner,
        pointer.x - active.startPointer.x,
        pointer.y - active.startPointer.y,
      );
      const memberRects = scaleRects(active.startUnion, targetUnion, active.targets.map((target) => target.startRect));
      active.targets.forEach((target, index) => {
        const desired = memberRects[index];
        if (!desired) return;
        const local = localSizeForRotatedBounds(desired.width, desired.height, target.startState.rotate, target.localSize);
        const state = { ...target.startState };
        applyStoredTransformStateToRect(target.element, state, { ...desired, ...local });
      });
    }
    overlays.refreshFromLiveGeometry();
  };

  const scheduleTransformPreview = (pointer: { x: number; y: number }): void => {
    const active = transformGesture;
    const view = root.defaultView;
    if (!active || !view) return;
    active.lastPointer = pointer;
    if (active.rafId !== 0) return;
    active.rafId = view.requestAnimationFrame(() => {
      active.rafId = 0;
      if (transformGesture === active) previewTransformAt(active, active.lastPointer);
    });
  };

  const finishTransformGesture = (commit: boolean): void => {
    const active = transformGesture;
    if (!active) return;
    const pointer = active.lastPointer;
    const exactBindings = active.targets.every((target) => target.element.isConnected && visualModel.bind(target.nodeId) === target.element);
    restoreTransformPreview(active);
    transformGesture = null;
    if (!commit || !exactBindings) {
      overlays.refreshFromLiveGeometry();
      return;
    }
    if (active.kind.startsWith("crop-")) {
      const insets = cropInsetsAt(active, pointer);
      const cropResult = runtime.cropSelection(insets);
      logV2("crop-gesture-commit", { ok: cropResult.ok, insets, error: cropResult.ok ? undefined : cropResult.error });
      cropMode = false;
      overlays.setCropMode(false);
      refreshToolbar();
    } else if (active.kind === "rotate") {
      const center = { x: active.startUnion.x + active.startUnion.width / 2, y: active.startUnion.y + active.startUnion.height / 2 };
      const initial = Math.atan2(active.startPointer.y - center.y, active.startPointer.x - center.x);
      const current = Math.atan2(pointer.y - center.y, pointer.x - center.x);
      runtime.rotateSelection((current - initial) * 180 / Math.PI);
    } else {
      runtime.resizeSelection(resizeRectFromCorner(
        active.startUnion,
        active.kind.slice(-2) as ResizeCorner,
        pointer.x - active.startPointer.x,
        pointer.y - active.startPointer.y,
      ));
    }
  };

  const beginTransformGesture = (
    kind: TransformGesture["kind"],
    event: PointerEvent,
  ): void => {
    if (transformGesture) finishTransformGesture(false);
    let roots = effectRoots(selectedIds());
    if (kind.startsWith("crop-") && roots.length !== 1) return;
    if (kind.startsWith("crop-")) {
      const selected = roots[0] ? visualModel.bind(roots[0]) : null;
      const subject = selected ? resolveCropSubject(selected) : null;
      const subjectId = subject ? visualModel.adopt(subject) : null;
      if (!subjectId) return;
      roots = [subjectId];
    }
    const measured = visualModel.measure(roots);
    const targets: TransformPreviewTarget[] = [];
    for (const nodeId of roots) {
      const element = visualModel.bind(nodeId);
      const startRect = measured.get(nodeId);
      if (!element || !startRect) return;
      const state = initialTransformState(element);
      targets.push({
        nodeId,
        element,
        snapshot: captureElementDomSnapshot(element, root),
        startRect,
        startState: state,
        localSize: {
          width: state.width ?? element.offsetWidth,
          height: state.height ?? element.offsetHeight,
        },
      });
    }
    const startUnion = unionRects(targets.map((target) => target.startRect));
    const view = root.defaultView;
    if (!startUnion || targets.length === 0 || !view) return;
    const active: TransformGesture = {
      id: nextOperationId("gesture"),
      kind,
      startPointer: { x: event.clientX, y: event.clientY },
      startUnion,
      targets,
      lastPointer: { x: event.clientX, y: event.clientY },
      rafId: 0,
      ...(kind.startsWith("crop-") && targets[0] ? { cropInsets: readStoredCropInsets(targets[0].element) } : {}),
    };
    transformGesture = active;
    if (kind.startsWith("crop-")) logV2("crop-gesture-start", { roots, startUnion, pointer: active.startPointer });
    const onMove = (move: PointerEvent): void => {
      if (transformGesture === active) scheduleTransformPreview({ x: move.clientX, y: move.clientY });
    };
    const cleanup = (): void => {
      view.removeEventListener("pointermove", onMove, true);
      view.removeEventListener("pointerup", onUp, true);
      view.removeEventListener("pointercancel", onCancel, true);
    };
    const onUp = (up: PointerEvent): void => {
      active.lastPointer = { x: up.clientX, y: up.clientY };
      cleanup();
      finishTransformGesture(true);
    };
    const onCancel = (): void => {
      cleanup();
      finishTransformGesture(false);
    };
    view.addEventListener("pointermove", onMove, true);
    view.addEventListener("pointerup", onUp, true);
    view.addEventListener("pointercancel", onCancel, true);
  };

  const beginMoveGesture = (event: NormalizedPointer, clickPick: VisualNodeId | null = null): boolean => {
    const roots = effectRoots(selectedIds());
    const targets: PreviewTarget[] = [];
    const elements = new Set<HTMLElement>();
    for (const nodeId of roots) {
      const element = visualModel.bind(nodeId);
      if (!element || elements.has(element)) return false;
      elements.add(element);
      targets.push({
        nodeId,
        element,
        startPointer: { x: event.clientX, y: event.clientY },
        startRect: rectFromElement(element),
        styleSnapshot: element.getAttribute("style"),
        committedTransform: element.style.transform,
      });
    }
    gesture = {
      kind: "move",
      startPointer: { x: event.clientX, y: event.clientY },
      targets,
      clickPick,
    };
    return targets.length > 0;
  };

  const onPointerDown = (event: NormalizedPointer): void => {
    if (event.target instanceof Element && isExtensionRoot(event.target)) {
      return;
    }
    if (overlays.isLassoChooserOpen()) {
      overlays.closeLassoChooser();
      return;
    }
    if (armedLassoMode === "rectangle") {
      gesture = {
        kind: "lasso",
        startPointer: { x: event.clientX, y: event.clientY },
        shiftKey: event.shiftKey,
        picked: null,
        active: false,
      };
      return;
    }
    if (armedLassoMode === "freeform") {
      gesture = {
        kind: "freeform",
        pointerId: event.pointerId,
        startPointer: { x: event.clientX, y: event.clientY },
        points: [{ x: event.clientX, y: event.clientY }],
        additive: event.shiftKey,
      };
      overlays.showFreeformLasso(gesture.points);
      return;
    }
    const picked = visualModel.pick(event.clientX, event.clientY);
    if (event.shiftKey) {
      gesture = {
        kind: "lasso",
        startPointer: { x: event.clientX, y: event.clientY },
        shiftKey: true,
        picked,
        active: false,
      };
      return;
    }

    const selectedRect = unionRects(visualModel.measure(selectedIds()).values());
    const hitSelected = Boolean(selectedRect && event.clientX >= selectedRect.x && event.clientX <= selectedRect.x + selectedRect.width && event.clientY >= selectedRect.y && event.clientY <= selectedRect.y + selectedRect.height);
    if (hitSelected && beginMoveGesture(event, picked)) return;

    if (picked) {
      const element = visualModel.bind(picked);
      if (!element) {
        setSelection(emptySelection());
        return;
      }
      setSelection(selectionFromAtoms([atomForNode(picked)], "click"));
      beginMoveGesture(event);
      return;
    }

    gesture = {
      kind: "lasso",
      startPointer: { x: event.clientX, y: event.clientY },
      shiftKey: false,
      picked: null,
      active: false,
    };
  };

  const onPointerMove = (event: NormalizedPointer): void => {
    if (!gesture) {
      return;
    }
    const dx = event.clientX - gesture.startPointer.x;
    const dy = event.clientY - gesture.startPointer.y;
    if (gesture.kind === "freeform") {
      const next = { x: event.clientX, y: event.clientY };
      const last = gesture.points[gesture.points.length - 1];
      if (shouldAppendFreeformPoint(last, next) && gesture.points.length < 1024) {
        gesture.points.push(next);
      }
      overlays.showFreeformLasso(gesture.points);
      return;
    }
    if (gesture.kind === "lasso") {
      if (!gesture.active && Math.hypot(dx, dy) < LASSO_THRESHOLD_PX) return;
      gesture.active = true;
      overlays.showLasso(normalizeRect(gesture.startPointer.x, gesture.startPointer.y, event.clientX, event.clientY));
      return;
    }
    if (gesture.targets.some((target) => !target.element.isConnected)) {
      cancelGesture();
      return;
    }
    if (Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) return;
    applyPreview(dx, dy);
    overlays.refreshFromLiveGeometry();
  };

  const onPointerUp = (event: NormalizedPointer): void => {
    if (!gesture) {
      return;
    }
    const active = gesture;
    const dx = event.clientX - active.startPointer.x;
    const dy = event.clientY - active.startPointer.y;
    if (active.kind === "freeform") {
      const rawCount = active.points.length;
      const polygon = simplifyPolygon(active.points);
      const additive = active.additive;
      gesture = null;
      armedLassoMode = null;
      overlays.clearLasso();
      if (isMeaningfulFreeform(polygon)) {
        const started = performance.now();
        const samples = buildInsidePolygonSamples(polygon);
        runtime.selectPolygon(polygon, additive ? "add" : "replace");
        overlays.setLassoDiagnostics({
          raw: rawCount,
          simplified: polygon.length,
          samples: samples.length,
          selected: selectedIds().length,
          ms: Math.round(performance.now() - started),
        });
      }
      refreshToolbar();
      return;
    }
    if (active.kind === "lasso") {
      const armed = armedLassoMode === "rectangle";
      gesture = null;
      armedLassoMode = null;
      overlays.clearLasso();
      if (!active.active && armed) {
        refreshToolbar();
        return;
      }
      if (!active.active && active.picked) {
        setSelection(toggleAtom(selection, atomForNode(active.picked)));
      } else if (active.active) {
        runtime.selectRect(
          normalizeRect(active.startPointer.x, active.startPointer.y, event.clientX, event.clientY),
          active.shiftKey ? "add" : "replace",
        );
      } else if (!active.shiftKey) {
        runtime.clearSelection();
      }
      refreshToolbar();
      return;
    }
    restorePreview();
    gesture = null;

    if (active.targets.some((target) => !target.element.isConnected) || Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) {
      if (active.clickPick && !active.targets.some((target) => target.nodeId === active.clickPick)) {
        setSelection(selectionFromAtoms([atomForNode(active.clickPick)], "click"));
      }
      overlays.refreshFromLiveGeometry();
      refreshSave();
      return;
    }

    ignoreMutations = true;
    const result = executor.executeMoveBatch({
      nodeIds: active.targets.map((target) => target.nodeId),
      dx,
      dy,
      pageKey: pageKey(),
    });
    releaseMutationIgnore();
    logV2("move", {
      owner: result.ok ? "EXECUTION" : "EXECUTION",
      ok: result.ok,
      dx,
      dy,
      nodeIds: active.targets.map((target) => target.nodeId),
      error: result.ok ? undefined : result.error,
    });
    renderSelection();
    refreshSave();
    overlays.refreshFromLiveGeometry();
    if (!result.ok) {
      logV2("move-failed", { owner: "EXECUTION", error: result.error });
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const keyboardTarget = event.target instanceof HTMLElement ? event.target : null;
    const textEntry = keyboardTarget && (
      keyboardTarget.matches("input, textarea, select") || keyboardTarget.isContentEditable
    );
    if (textEntry) return;
    if (
      event.key.toLowerCase() === "t" &&
      !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    ) {
      if (selectedIds().length > 0) {
        event.preventDefault();
        toolbarOpen = !toolbarOpen;
        overlays.setToolbarVisible(toolbarOpen);
        refreshToolbar();
      }
      return;
    }
    if (event.key === "Escape") {
      if (overlays.closeLassoChooser()) {
        event.preventDefault();
        return;
      }
      if (armedLassoMode && !gesture) {
        armedLassoMode = null;
        refreshToolbar();
        event.preventDefault();
        return;
      }
      if (transformGesture) {
        finishTransformGesture(false);
      } else if (gesture) {
        cancelGesture();
      } else {
        runtime.clearSelection();
      }
      event.preventDefault();
      return;
    }
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      runtime.selectParent();
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "c") {
      if (runtime.copySelection()) event.preventDefault();
      return;
    }
    if (modifier && event.key.toLowerCase() === "v") {
      const result = runtime.pasteClipboard();
      if (result.ok) event.preventDefault();
      return;
    }
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) runtime.redo(); else runtime.undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault(); runtime.redo(); return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selectedIds().length > 0) { event.preventDefault(); runtime.deleteSelection(); }
      return;
    }
    if (modifier && event.key.toLowerCase() === "g") {
      event.preventDefault();
      if (event.shiftKey) runtime.ungroupSelection();
      else runtime.groupSelection();
      return;
    }
    const bracketRight = event.code === "BracketRight" || event.key === "]" || event.key === "}";
    const bracketLeft = event.code === "BracketLeft" || event.key === "[" || event.key === "{";
    if (modifier && (bracketRight || bracketLeft)) {
      event.preventDefault();
      const primary = selection.primary;
      if (primary?.kind === "node") {
        const command = bracketRight
          ? event.shiftKey ? "front" : "forward"
          : event.shiftKey ? "back" : "backward";
        runtime.layer(primary.nodeId, command);
      }
      return;
    }
    const undoKey = event.key === "z" && (event.ctrlKey || event.metaKey) && !event.shiftKey;
    const redoKey =
      (event.key === "y" && (event.ctrlKey || event.metaKey)) ||
      (event.key === "z" && (event.ctrlKey || event.metaKey) && event.shiftKey);
    if (undoKey) {
      event.preventDefault();
      runtime.undo();
      return;
    }
    if (redoKey) {
      event.preventDefault();
      runtime.redo();
    }
  };

  const attachInvalidation = (): void => {
    const view = root.defaultView;
    if (!view) {
      return;
    }
    owner().listen(view, "scroll", () => {
      overlays.refreshFromLiveGeometry();
    }, true);
    owner().listen(root, "scroll", () => {
      overlays.refreshFromLiveGeometry();
    }, true);
    owner().listen(view, "resize", () => {
      overlays.refreshFromLiveGeometry();
    });
    const observer = new MutationObserver((records) => {
      if (ignoreMutations || gesture || transformGesture || stylePreview) {
        return;
      }
      const relevant = records.some((record) => {
        const node = record.target;
        if (node instanceof Element) {
          const treeRoot = node.getRootNode();
          if (
            isExtensionRoot(node) ||
            (treeRoot instanceof ShadowRoot && isExtensionRoot(treeRoot.host))
          ) {
            return false;
          }
        }
        if (record.type === "attributes") {
          return record.attributeName === "style" || record.attributeName === OTF_TRANSFORM_ATTR;
        }
        return record.type === "childList";
      });
      if (!relevant) {
        return;
      }
      reapplyActive();
      overlays.refreshFromLiveGeometry();
    });
    observer.observe(root.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", OTF_TRANSFORM_ATTR],
      characterData: false,
    });
    owner().observe(observer);
  };

  const runtime: EditorRuntime = {
    visualModel,
    placement,
    executor,
    ledger,
    overlays,
    input,
    lifecycle: {
      start() {
        runtime.start();
      },
      stop() {
        runtime.stop();
      },
      onDocumentReady() {
        void runtime.replay();
      },
      onDomInvalidated() {
        reapplyActive();
        overlays.refreshFromLiveGeometry();
      },
    },
    start() {
      if (started) {
        return;
      }
      started = true;
      if (ownerHolder.current.isDisposed) {
        ownerHolder.current = new DisposableOwner();
      }
      overlays.mount();
      overlays.setHandlePointerDown(beginTransformGesture);
      refreshSave();
      applyUserSelect(true);
      owner().add(() => {
        applyUserSelect(false);
      });
      input.start({
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel() {
          cancelGesture();
        },
        onKeyDown,
        onModeChange(mode) {
          overlays.setMode(mode);
          if (mode === "interact") {
            cancelGesture();
            runtime.clearSelection();
            applyUserSelect(false);
          } else {
            applyUserSelect(true);
          }
          refreshSave();
        },
      });
      const view = root.defaultView;
      if (view) {
        owner().listen(view, "blur", () => {
          if (gesture?.kind === "freeform" || gesture?.kind === "lasso" && armedLassoMode) cancelGesture();
          else if (armedLassoMode && !gesture) { armedLassoMode = null; refreshToolbar(); }
        });
        owner().listen(view, "scroll", () => {
          if (gesture?.kind === "freeform") cancelGesture();
        }, true);
      }
      attachInvalidation();
      renderSelection();
    },
    stop() {
      finishTransformGesture(false);
      cancelGesture();
      resizeObserver?.disconnect();
      resizeObserver = null;
      overlays.unmount();
      input.stop();
      owner().dispose();
      started = false;
      selection = emptySelection();
      groups.clear();
      groupByMember.clear();
    },
    select(element) {
      const nodeId = visualModel.adopt(element);
      setSelection(nodeId ? selectionFromAtoms([atomForNode(nodeId)], "click") : emptySelection());
      return nodeId;
    },
    toggleSelection(element) {
      const nodeId = visualModel.adopt(element);
      if (nodeId) setSelection(toggleAtom(selection, atomForNode(nodeId)));
      return nodeId;
    },
    selectRect(rect, mode) {
      const atoms = resolveLasso(rect).map(atomForNode);
      setSelection(selectionFromAtoms(mode === "add" ? [...selection.atoms, ...atoms] : atoms, "lasso"));
      return selection;
    },
    selectPolygon(points, mode) {
      const atoms = resolveFreeform(points).map(atomForNode);
      setSelection(selectionFromAtoms(mode === "add" ? [...selection.atoms, ...atoms] : atoms, "lasso"));
      return selection;
    },
    armLasso(mode) {
      overlays.closeLassoChooser();
      armedLassoMode = mode;
      refreshToolbar();
    },
    clearSelection() {
      setSelection(emptySelection());
    },
    getSelection() {
      return selectionFromAtoms(selection.atoms, selection.source);
    },
    selectedNodeIds() {
      return selectedIds();
    },
    measureSelection() {
      return unionRects(visualModel.measure(selectedIds()).values());
    },
    measureGroup(groupId) {
      const group = groups.get(groupId);
      return group ? unionRects(visualModel.measure(group.memberIds).values()) : null;
    },
    getGroup(groupId) {
      return groups.get(groupId) ?? null;
    },
    groupSelection() {
      const normalized = normalizeSelection(selection.atoms, groups, selection.source);
      if (normalized.atoms.length === 1 && normalized.atoms[0]?.kind === "group") {
        selection = normalized;
        return normalized.atoms[0].groupId;
      }
      const memberIds = selectedIds();
      if (memberIds.length < 2) return null;
      if (memberIds.some((memberId) => !visualModel.bind(memberId))) return null;

      const memberSet = new Set(memberIds);
      const nextGroups = new Map<GroupId, RuntimeVirtualGroup>();
      for (const [existingId, existing] of groups) {
        if (!existing.memberIds.some((memberId) => memberSet.has(memberId))) {
          nextGroups.set(existingId, existing);
        }
      }
      const nextCounter = groupCounter + 1;
      const groupId: GroupId = `otf-group-${nextCounter.toString(36)}`;
      const group: RuntimeVirtualGroup = { id: groupId, memberIds };
      nextGroups.set(groupId, group);
      const nextReverse = new Map<VisualNodeId, GroupId>();
      for (const [nextGroupId, nextGroup] of nextGroups) {
        for (const memberId of nextGroup.memberIds) {
          if (nextReverse.has(memberId)) return null;
          nextReverse.set(memberId, nextGroupId);
        }
      }
      groups = nextGroups;
      groupByMember = nextReverse;
      groupCounter = nextCounter;
      setSelection(selectionFromAtoms([{ kind: "group", groupId }], "group"));
      return groupId;
    },
    ungroupSelection() {
      const atoms: SelectionAtom[] = [];
      const members: VisualNodeId[] = [];
      const removedGroups = new Set<GroupId>();
      for (const atom of selection.atoms) {
        if (atom.kind === "node") {
          atoms.push(atom);
          continue;
        }
        const group = groups.get(atom.groupId);
        if (!group) continue;
        removedGroups.add(atom.groupId);
        for (const memberId of group.memberIds) {
          atoms.push({ kind: "node", nodeId: memberId });
          members.push(memberId);
        }
      }
      if (members.length > 0) {
        groups = new Map([...groups].filter(([groupId]) => !removedGroups.has(groupId)));
        groupByMember = new Map(
          [...groups].flatMap(([groupId, group]) => group.memberIds.map((memberId) => [memberId, groupId] as const)),
        );
        setSelection(selectionFromAtoms(atoms, "group"));
      }
      return members;
    },
    copySelection() {
      const roots = effectRoots(selectedIds());
      logV2("copy-start", { selectedIds: selectedIds(), roots });
      const items: DuplicateOperation[] = [];
      const rootIndex = new Map<VisualNodeId, number>();
      for (const nodeId of roots) {
        const element = visualModel.bind(nodeId);
        const identity = visualModel.durableIdentityOf(nodeId);
        const measured = visualModel.measure([nodeId]).get(nodeId);
        if (!element || !identity || !measured) {
          logV2("copy-failed", { nodeId, element: Boolean(element), identity: Boolean(identity), measured: Boolean(measured) });
          return false;
        }
        const built = buildDuplicateFromClipboardEntry({
          element,
          target: { nodeId, signature: identity.signature, rect: measured },
        }, pageKey(), `clipboard-${nodeId}`, -1);
        if (!built) {
          logV2("copy-failed", { nodeId, reason: "snapshot_rejected", tag: element.tagName, role: element.getAttribute("role") });
          return false;
        }
        items.push(JSON.parse(JSON.stringify(built.operation)) as DuplicateOperation);
        rootIndex.set(nodeId, items.length - 1);
      }
      if (items.length === 0) {
        logV2("copy-failed", { reason: "no_effect_roots", selectedIds: selectedIds() });
        return false;
      }
      const groupPartitions = selection.atoms.flatMap((atom) => {
        if (atom.kind !== "group") return [];
        const group = groups.get(atom.groupId);
        if (!group) return [];
        const indices = group.memberIds.map((id) => rootIndex.get(id)).filter((index): index is number => index !== undefined);
        return indices.length > 1 ? [indices] : [];
      });
      clipboard = Object.freeze({ copiedAt: Date.now(), items: Object.freeze(items), groupPartitions: Object.freeze(groupPartitions) });
      pasteCounter = 0;
      return true;
    },
    pasteClipboard() {
      if (!clipboard) return { ok: false, error: "clipboard_empty", rolledBack: false };
      pasteCounter += 1;
      const offset = 20 * pasteCounter;
      const operations = clipboard.items.map((template): DuplicateOperation => {
        const cloneId = nextOperationId("clone");
        const pastedRect = {
          x: template.payload.anchorLeft - (root.defaultView?.scrollX ?? 0) + offset,
          y: template.payload.anchorTop - (root.defaultView?.scrollY ?? 0) + offset,
          width: template.payload.anchorWidth,
          height: template.payload.anchorHeight,
        };
        return {
          ...JSON.parse(JSON.stringify(template)) as DuplicateOperation,
          id: nextOperationId("duplicate"),
          target: { ...template.target, nodeId: cloneId },
          payload: { ...template.payload, cloneId, offsetDx: offset, offsetDy: offset },
          createdAt: Date.now(),
          status: "approved",
          metadata: { ...template.metadata, originalRect: pastedRect, finalRect: pastedRect, affectedRect: pastedRect },
        };
      });
      const expected = new Map(operations.map((operation) => [operation.id, {
        x: operation.payload.anchorLeft - (root.defaultView?.scrollX ?? 0) + operation.payload.offsetDx,
        y: operation.payload.anchorTop - (root.defaultView?.scrollY ?? 0) + operation.payload.offsetDy,
        width: operation.payload.anchorWidth,
        height: operation.payload.anchorHeight,
      }]));
      const result = executor.executeTransaction({ operations, expectedRects: expected });
      if (!result.ok) {
        logV2("paste-failed", { error: result.error, result, operationIds: operations.map((operation) => operation.id) });
        return result;
      }
      const cloneIds = result.operations.map((operation) => operation.target.nodeId).filter((id): id is VisualNodeId => Boolean(id));
      pastePartitions.set(transactionKey(result.operations), clipboard.groupPartitions);
      const nextAtoms = restorePasteGroups(cloneIds, clipboard.groupPartitions);
      setSelection(selectionFromAtoms(nextAtoms, clipboard.groupPartitions.length ? "group" : "click"));
      refreshSave();
      return result;
    },
    deleteSelection() {
      const roots = effectRoots(selectedIds());
      const operations = roots.flatMap((nodeId) => {
        const element = visualModel.bind(nodeId);
        const identity = visualModel.durableIdentityOf(nodeId);
        const measured = visualModel.measure([nodeId]).get(nodeId);
        if (!element || !identity || !measured) return [];
        const operation = buildHideOperation({ nodeId, signature: identity.signature, rect: measured }, true, { pageKey: pageKey(), sourceCommand: "delete" }, element.style.display || getComputedStyle(element).display, element);
        return [{ ...operation, id: nextOperationId("hide"), status: "approved" as const, target: { nodeId, signature: identity.signature }, metadata: { ...operation.metadata, originalRect: measured, finalRect: measured, affectedRect: measured } }];
      });
      if (operations.length !== roots.length) return { ok: false, error: "delete_target_unresolved", rolledBack: false };
      ignoreMutations = true;
      const result = executor.executeTransaction({ operations });
      releaseMutationIgnore();
      logV2("delete", { ok: result.ok, selectedNodeIds: roots, operationIds: operations.map((operation) => operation.id), error: result.ok ? undefined : result.error });
      if (result.ok) { runtime.clearSelection(); refreshSave(); }
      return result;
    },
    resizeSelection(targetRect) {
      const roots = effectRoots(selectedIds());
      const measured = visualModel.measure(roots);
      const rects = roots.map((id) => measured.get(id)).filter((rect): rect is IntendedRect => Boolean(rect));
      const startUnion = unionRects(rects);
      if (!startUnion || rects.length !== roots.length) return { ok: false, error: "resize_target_unresolved", rolledBack: false };
      const targets = scaleRects(startUnion, targetRect, rects);
      const operations: ResizeOperation[] = [];
      for (const [index, nodeId] of roots.entries()) {
        const identity = visualModel.durableIdentityOf(nodeId);
        const current = rects[index];
        const target = targets[index];
        const element = visualModel.bind(nodeId);
        if (!identity || !current || !target || !element) return { ok: false, error: "resize_target_unresolved", rolledBack: false };
        const state = initialTransformState(element);
        const local = localSizeForRotatedBounds(target.width, target.height, state.rotate, {
          width: state.width ?? element.offsetWidth,
          height: state.height ?? element.offsetHeight,
        });
        const drafted = buildResizeOperation({ nodeId, signature: identity.signature, rect: current }, { width: local.width, height: local.height, mode: "box" }, { pageKey: pageKey(), sourceCommand: "resize" });
        operations.push({ ...drafted, id: nextOperationId("resize"), status: "approved", target: { nodeId, signature: identity.signature }, metadata: { ...drafted.metadata, originalRect: current, finalRect: target, affectedRect: target } });
      }
      const expected = new Map(operations.map((operation) => [operation.id, operation.metadata?.finalRect ?? targetRect]));
      const result = executor.executeTransaction({ operations, expectedRects: expected });
      if (result.ok) { renderSelection(); refreshSave(); }
      return result;
    },
    rotateSelection(degrees) {
      const roots = effectRoots(selectedIds());
      const measured = visualModel.measure(roots);
      const rects = roots.map((id) => measured.get(id)).filter((rect): rect is IntendedRect => Boolean(rect));
      const union = unionRects(rects);
      if (!union || rects.length !== roots.length) return { ok: false, error: "rotate_target_unresolved", rolledBack: false };
      const operations: EditorOperation[] = [];
      const expected = new Map<string, IntendedRect>();
      for (const [index, nodeId] of roots.entries()) {
        const identity = visualModel.durableIdentityOf(nodeId);
        const current = rects[index];
        const element = visualModel.bind(nodeId);
        if (!identity || !current || !element) return { ok: false, error: "rotate_target_unresolved", rolledBack: false };
        const target = rotatedMemberRect(current, union, degrees);
        const dx = target.x - current.x;
        const dy = target.y - current.y;
        if (Math.hypot(dx, dy) > 0.01) {
          const plan = placement.planMove({ element, currentRect: current, dx, dy });
          const move = buildMoveOperation({ nodeId, signature: identity.signature, rect: current }, dx, dy, { pageKey: pageKey(), sourceCommand: "rotate:move" });
          const committed: MoveOperation = { ...move, id: nextOperationId("move"), status: "approved", payload: { ...move.payload, ...plan.payload }, metadata: { ...move.metadata, originalRect: current, finalRect: plan.expectedRect, affectedRect: plan.expectedRect } };
          operations.push(committed); expected.set(committed.id, plan.expectedRect);
        }
        const existing = readStoredTransformState(element)?.rotate ?? 0;
        const rotate = buildRotateOperation({ nodeId, signature: identity.signature, rect: target }, existing + degrees, { pageKey: pageKey(), sourceCommand: "rotate" });
        operations.push({ ...rotate, id: nextOperationId("rotate"), status: "approved", target: { nodeId, signature: identity.signature }, metadata: { ...rotate.metadata, originalRect: current, finalRect: target, affectedRect: target } });
      }
      const result = executor.executeTransaction({ operations, expectedRects: expected });
      if (result.ok) { renderSelection(); refreshSave(); }
      return result;
    },
    moveSelection(dx, dy): BatchExecutionResult {
      const roots = effectRoots(selectedIds());
      ignoreMutations = true;
      const result = executor.executeMoveBatch({ nodeIds: roots, dx, dy, pageKey: pageKey() });
      releaseMutationIgnore();
      refreshSave();
      renderSelection();
      return result;
    },
    selectParent() {
      const primary = selection.primary;
      if (!primary || primary.kind !== "node") {
        return null;
      }
      const parentId = visualModel.parentOf(primary.nodeId);
      if (!parentId) {
        return null;
      }
      const parent = visualModel.get(parentId);
      if (!parent || parent.role === "root") {
        return null;
      }
      setSelection(selectionFromAtoms([atomForNode(parentId)], "click"));
      return parentId;
    },
    move(nodeId, dx, dy): ExecutionResult {
      ignoreMutations = true;
      const result = executor.executeMove({
        nodeId,
        dx,
        dy,
        pageKey: pageKey(),
      });
      releaseMutationIgnore();
      if (result.ok) {
        setSelection(selectionFromAtoms([atomForNode(nodeId)], "click"));
      }
      refreshSave();
      overlays.refreshFromLiveGeometry();
      return result;
    },
    layer(nodeId, command): ExecutionResult {
      ignoreMutations = true;
      const result = executor.executeLayer({ nodeId, command, pageKey: pageKey() });
      releaseMutationIgnore();
      if (result.ok) {
        setSelection(selectionFromAtoms([atomForNode(nodeId)], "click"));
      }
      refreshSave();
      overlays.refreshFromLiveGeometry();
      logV2("layer", { owner: "EXECUTION", ok: result.ok, command, error: result.ok ? undefined : result.error });
      return result;
    },
    styleSelection(styles): BatchExecutionResult {
      cancelStylePreview();
      const pending = exclusiveFillStyles(styles);
      const roots = effectRoots(selectedIds());
      if (roots.length === 0 || pending.size === 0) return { ok: false, error: "empty_style_transaction", rolledBack: false };
      const operations: EditorOperation[] = [];
      for (const nodeId of roots) {
        const element = visualModel.bind(nodeId);
        const identity = visualModel.durableIdentityOf(nodeId);
        const rect = visualModel.measure([nodeId]).get(nodeId);
        if (!element || !identity || !rect) return { ok: false, error: "style_target_unresolved", rolledBack: false };
        for (const [property, value] of pending) {
          const previousValue = getComputedStyle(resolveStyleRealizationTarget(element, property)).getPropertyValue(STYLE_CSS_MAP[property]);
          const drafted = buildStyleOperation({ nodeId, signature: identity.signature, rect }, property, value, { pageKey: pageKey(), sourceCommand: "style" }, previousValue, element);
          const wantsSubtree = TEXT_STYLE_PROPERTIES.has(property) && textSurface(element) !== element;
          const subtree = wantsSubtree ? textSubtreeStyleTargets(element) : [];
          if (wantsSubtree && subtree.length === 0) continue;
          const scope = wantsSubtree ? "text-subtree" as const : "self" as const;
          operations.push({ ...drafted, payload: { ...drafted.payload, scope }, id: nextOperationId("style"), status: "approved", target: { nodeId, signature: identity.signature } });
        }
      }
      if (operations.length === 0) return { ok: false, error: "empty_style_transaction", rolledBack: false };
      const result = executor.executeTransaction({ operations });
      if (result.ok) { renderSelection(); refreshSave(); }
      return result;
    },
    editSelectedText(value): ExecutionResult {
      const selected = singleSelectedElement();
      const surface = selected ? textSurface(selected.element) : null;
      const surfaceId = surface ? visualModel.adopt(surface) : null;
      if (!selected || !surface || !surfaceId) return { ok: false, error: "text_target_unsafe", rolledBack: false };
      const identity = visualModel.durableIdentityOf(surfaceId);
      const rect = visualModel.measure([surfaceId]).get(surfaceId);
      if (!identity || !rect) return { ok: false, error: "text_target_unresolved", rolledBack: false };
      const drafted = buildTextOperation({ nodeId: surfaceId, signature: identity.signature, rect }, value, { pageKey: pageKey(), sourceCommand: "text-edit" }, renderedVisibleText(surface), surface);
      const operation = { ...drafted, id: nextOperationId("text"), status: "approved" as const, target: { nodeId: surfaceId, signature: identity.signature } };
      ignoreMutations = true;
      const result = executor.executeTransaction({ operations: [operation] });
      releaseMutationIgnore();
      if (result.ok) { renderSelection(); refreshSave(); return { ok: true, operation: result.operations[0] ?? operation, verification: result.verifications[0] ?? { ok: true, expected: rect, actual: rect } }; }
      return result;
    },
    cropSelection(insets): ExecutionResult {
      const selected = singleSelectedElement();
      const subject = selected ? resolveCropSubject(selected.element) : null;
      const subjectId = subject ? visualModel.adopt(subject) : null;
      if (!selected || !subject || !subjectId || !canCrop(selected.element)) return { ok: false, error: "crop_target_unsafe", rolledBack: false };
      const identity = visualModel.durableIdentityOf(subjectId);
      const rect = visualModel.measure([subjectId]).get(subjectId);
      if (!identity || !rect) return { ok: false, error: "crop_target_unresolved", rolledBack: false };
      const drafted = buildCropOperation({ nodeId: subjectId, signature: identity.signature, rect }, insets, { pageKey: pageKey(), sourceCommand: "crop" });
      const operation: CropOperation = { ...drafted, id: nextOperationId("crop"), status: "approved", target: { nodeId: subjectId, signature: identity.signature } };
      ignoreMutations = true;
      const result = executor.executeTransaction({ operations: [operation] });
      releaseMutationIgnore();
      if (result.ok) { renderSelection(); refreshSave(); return { ok: true, operation: result.operations[0] ?? operation, verification: result.verifications[0] ?? { ok: true, expected: rect, actual: rect } }; }
      return result;
    },
    canUndo() { return ledger.canUndo(); },
    canRedo() { return ledger.canRedo(); },
    undo() {
      const operations = [...ledger.peekUndoTransaction()];
      if (operations.length === 0) {
        return { ok: false, error: "nothing_to_undo", rolledBack: false };
      }
      ignoreMutations = true;
      const result = executor.revertCommittedBatch(operations);
      releaseMutationIgnore();
      if (result.ok) {
        if (operations.every((operation) => operation.type === "duplicate")) {
          removeGroupsContaining(new Set(operations.map((operation) => operation.target.nodeId).filter((id): id is VisualNodeId => Boolean(id))));
          runtime.clearSelection();
        }
        ledger.confirmUndoTransaction();
      }
      logV2("undo", { ok: result.ok, error: result.ok ? undefined : result.error, operationIds: operations.map((operation) => operation.id) });
      refreshSave();
      overlays.refreshFromLiveGeometry();
      return result;
    },
    redo() {
      const operations = [...ledger.peekRedoTransaction()];
      if (operations.length === 0) {
        return { ok: false, error: "nothing_to_redo", rolledBack: false };
      }
      ignoreMutations = true;
      const result = executor.reapplyCommittedBatch(operations);
      releaseMutationIgnore();
      if (result.ok) {
        ledger.confirmRedoTransaction();
        const partitions = pastePartitions.get(transactionKey(operations));
        if (partitions) {
          const cloneIds = result.operations.map((operation) => operation.target.nodeId).filter((id): id is VisualNodeId => Boolean(id));
          setSelection(selectionFromAtoms(restorePasteGroups(cloneIds, partitions), partitions.length ? "group" : "click"));
        }
      }
      refreshSave();
      overlays.refreshFromLiveGeometry();
      return result;
    },
    async save(): Promise<PersistResult> {
      if (saveInFlight) {
        return saveInFlight;
      }
      saveStatus = "saving";
      lastSaveError = undefined;
      refreshSave();
      const pending = (async (): Promise<PersistResult> => {
        const active = ledger.activeOperations();
        const checkpointRevision = ledger.cursor;
        const checkpoint = projectCanonicalCheckpoint(active);
        if (!checkpoint.ok) {
          logV2("save", {
            owner: "LEDGER",
            pageKey: pageKey(),
            ledgerRevision: ledger.cursor,
            error: checkpoint.error,
          });
          return {
            ok: false,
            error: checkpoint.error,
            failureKind: "IDENTITY",
          };
        }
        const projection = JSON.parse(JSON.stringify(checkpoint.operations)) as EditorOperation[];
        const cloneCreations = projection.filter((operation): operation is DuplicateOperation => operation.type === "duplicate");
        const liveCloneCounts = new Map<string, number>();
        for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-otf-clone-id]"))) {
          const cloneId = element.getAttribute("data-otf-clone-id");
          if (cloneId) liveCloneCounts.set(cloneId, (liveCloneCounts.get(cloneId) ?? 0) + 1);
        }
        const creationIds = new Set(cloneCreations.map((operation) => operation.payload.cloneId));
        const invalidLiveClone = [...liveCloneCounts].find(([cloneId, count]) => count !== 1 || !creationIds.has(cloneId));
        const missingLiveClone = cloneCreations.find((operation) => liveCloneCounts.get(operation.payload.cloneId) !== 1);
        if (invalidLiveClone || missingLiveClone) {
          const error = invalidLiveClone
            ? `live_clone_identity_invalid:${invalidLiveClone[0]}:${String(invalidLiveClone[1])}`
            : `live_clone_missing:${missingLiveClone?.payload.cloneId ?? "unknown"}`;
          logV2("save", { owner: "IDENTITY", checkpointRevision, checkpointCount: projection.length, error, storageCalled: false });
          return { ok: false, error, failureKind: "IDENTITY" };
        }
        const persistedRevisionBefore = ledger.persistedRevision;
        const identities = projection.map((operation) =>
          operation.target.signature
            ? summarizeIdentity({ signature: operation.target.signature })
            : "missing",
        );
        const persist = await replacePageOperations(pageKey(), projection);
        logV2("save", {
          owner: persist.ok ? "PERSISTENCE" : "PERSISTENCE",
          pageKey: pageKey(),
          ledgerRevision: ledger.cursor,
          persistedRevisionBefore,
          checkpointCount: projection.length,
          checkpointRevision,
          serializedBytes: new TextEncoder().encode(JSON.stringify(projection)).byteLength,
          cloneEntityCount: cloneCreations.length,
          hostEntityCount: new Set(projection.flatMap((operation) => {
            const signature = operation.target.signature;
            return operation.type !== "duplicate" && !creationIds.has(operation.target.nodeId ?? "") && signature
              ? [summarizeIdentity({ signature })]
              : [];
          })).size,
          perPropertyCounts: Object.fromEntries(["duplicate", "move", "resize", "rotate", "crop", "style", "text", "zIndex", "hide"].map((type) => [type, projection.filter((operation) => operation.type === type).length])),
          cloneCreationIds: cloneCreations.map((operation) => operation.payload.cloneId),
          storageCalled: true,
          operationIds: projection.map((operation) => operation.id),
          identities,
          writeOk: persist.ok,
          error: persist.ok ? undefined : persist.error,
        });
        if (!persist.ok) {
          return {
            ok: false,
            error: persist.error ?? "save_failed",
            failureKind: "PERSISTENCE",
          };
        }
        ledger.markPersisted(checkpointRevision);
        return { ok: true };
      })();
      const tracked = pending.catch((error: unknown): PersistResult => ({
        ok: false,
        error: error instanceof Error ? error.message : "save_failed",
        failureKind: "PERSISTENCE",
      }));
      saveInFlight = tracked;
      try {
        const result = await tracked;
        saveStatus = result.ok ? "saved" : "failed";
        lastSaveError = result.ok ? undefined : result.error ?? "save_failed";
        if (result.ok) {
          root.defaultView?.setTimeout(() => {
            if (saveStatus === "saved") {
              saveStatus = "idle";
              refreshSave();
            }
          }, 900);
        }
        return result;
      } finally {
        if (saveInFlight === tracked) {
          saveInFlight = null;
        }
        refreshSave();
      }
    },
    async replay(): Promise<ReplayResult> {
      const generation = ++replayGeneration;
      const startingRevision = ledger.cursor;
      if (started || ledger.isDirty()) {
        logV2("replay-skipped-active-edit", { owner: "LEDGER", generation, startingRevision, dirty: ledger.isDirty() });
        return { ok: true, applied: 0, unresolved: 0, failed: 0 };
      }
      const superseded = (): boolean => generation !== replayGeneration || started || ledger.cursor !== startingRevision;
      await waitForDocumentReady(root);
      const loaded = await loadPageOperations(pageKey());
      if (superseded()) {
        logV2("replay-superseded", { owner: "LEDGER", generation, startingRevision, currentRevision: ledger.cursor });
        return { ok: true, applied: 0, unresolved: 0, failed: 0 };
      }
      const checkpoint = projectCanonicalCheckpoint(loaded);
      const toApply = checkpoint.ok ? checkpoint.operations : loaded;
      // Reconstruct ancestor-controlled layout before promoting independent
      // children. This keeps parent identities resolvable against the pristine
      // DOM and lets detached children establish their saved world rect last.
      const moves = toApply.filter(isMoveOperation).sort((a, b) =>
        Number(a.payload.detached) - Number(b.payload.detached));
      const layers = toApply.filter(isLayerOperation);
      const duplicates = toApply.filter((operation): operation is DuplicateOperation => operation.type === "duplicate");
      const effects = toApply.filter((operation) =>
        operation.type === "resize" || operation.type === "rotate" || operation.type === "crop" ||
        operation.type === "style" || operation.type === "text" || operation.type === "hide");
      if (duplicates.length > 0 && root.readyState !== "complete") {
        await new Promise<void>((resolve) => {
          root.defaultView?.addEventListener("load", () => { resolve(); }, { once: true });
          root.defaultView?.setTimeout(resolve, 2_000);
        });
      }
      if (superseded()) return { ok: true, applied: 0, unresolved: 0, failed: 0 };
      const duplicateResults = duplicates.map((operation) => executor.replayOperation(operation));
      await waitForReplayTargets(root, [...moves, ...effects, ...layers], {
        maxFrames: 240,
        canResolve: (operation) => Boolean(
          operation.target.signature &&
          isResolvedVisual(visualModel.resolveIdentity({ signature: operation.target.signature })),
        ),
      });
      if (superseded()) {
        logV2("replay-superseded", { owner: "LEDGER", generation, startingRevision, currentRevision: ledger.cursor });
        return { ok: true, applied: 0, unresolved: 0, failed: 0 };
      }
      let applied = 0;
      let unresolved = 0;
      let failed = 0;
      let failureKind: ReplayResult["failureKind"];
      for (const result of duplicateResults) {
        if (result.ok) applied += 1;
        else { failed += 1; failureKind = "EXECUTION"; logV2("replay-duplicate-failed", { error: result.error }); }
      }
      ignoreMutations = true;
      logV2("replay-start", {
        owner: "LEDGER",
        pageKey: pageKey(),
        loadedIds: loaded.map((operation) => operation.id),
        checkpointCount: toApply.length,
        compacted: checkpoint.ok,
      });
      for (const operation of moves) {
        const identity = operation.target.signature
          ? { signature: operation.target.signature }
          : null;
        const resolution = identity
          ? visualModel.resolveIdentity(identity)
          : {
              kind: "unresolved" as const,
              evidence: { reason: "missing_signature" },
            };
        const result = executor.replayMove(operation);
        logV2("replay-item", {
          owner:
            resolution.kind === "resolved"
              ? result.ok
                ? "EXECUTION"
                : "EXECUTION"
              : "IDENTITY",
          id: operation.id,
          identity: identity ? summarizeIdentity(identity) : "missing",
          resolution: resolution.kind,
          evidence: "evidence" in resolution ? resolution.evidence : undefined,
          applyOk: result.ok,
          error: result.ok ? undefined : result.error,
          expected: result.ok ? result.verification.expected : result.verification?.expected,
          actual: result.ok ? result.verification.actual : result.verification?.actual,
        });
        if (result.ok) {
          applied += 1;
          continue;
        }
        if (result.error === "unresolved_target" || result.error === "ambiguous_target") {
          unresolved += 1;
          failureKind = "IDENTITY";
        } else {
          failed += 1;
          failureKind = "EXECUTION";
        }
      }
      for (const operation of effects) {
        const identity = operation.target.signature ? { signature: operation.target.signature } : null;
        const resolution = identity ? visualModel.resolveIdentity(identity) : { kind: "unresolved" as const, evidence: { reason: "missing_signature" } };
        const result = executor.replayOperation(operation);
        logV2("replay-item", { owner: resolution.kind === "resolved" ? "EXECUTION" : "IDENTITY", id: operation.id, operationType: operation.type, resolution: resolution.kind, evidence: "evidence" in resolution ? resolution.evidence : undefined, applyOk: result.ok, error: result.ok ? undefined : result.error });
        if (result.ok) applied += 1;
        else if (result.error === "unresolved_target" || result.error === "ambiguous_target") { unresolved += 1; failureKind = "IDENTITY"; }
        else { failed += 1; failureKind = "EXECUTION"; }
      }
      for (const move of moves) {
        const expected = move.metadata?.finalRect;
        if (!expected || !move.target.signature) continue;
        const resolved = visualModel.resolveIdentity({ signature: move.target.signature });
        if (!isResolvedVisual(resolved)) continue;
        const current = rectFromElement(resolved.element);
        if (rectsNear(current, expected)) continue;
        const correction = executor.replayMove({
          ...move,
          target: { ...move.target, ...(resolved.nodeId ? { nodeId: resolved.nodeId } : {}) },
          payload: { ...move.payload, dx: expected.x - current.x, dy: expected.y - current.y },
        });
        if (correction.ok) applied += 1;
        else { failed += 1; failureKind = "EXECUTION"; }
      }
      for (const operation of layers) {
        const identity = operation.target.signature
          ? { signature: operation.target.signature }
          : null;
        const resolution = identity
          ? visualModel.resolveIdentity(identity)
          : { kind: "unresolved" as const, evidence: { reason: "missing_signature" } };
        const result = executor.replayLayer(operation);
        logV2("replay-item", {
          owner: resolution.kind === "resolved" ? "EXECUTION" : "IDENTITY",
          id: operation.id,
          identity: identity ? summarizeIdentity(identity) : "missing",
          operationType: "zIndex",
          resolution: resolution.kind,
          evidence: "evidence" in resolution ? resolution.evidence : undefined,
          applyOk: result.ok,
          error: result.ok ? undefined : result.error,
        });
        if (result.ok) applied += 1;
        else if (result.error === "unresolved_target" || result.error === "ambiguous_target") {
          unresolved += 1; failureKind = "IDENTITY";
        } else { failed += 1; failureKind = "EXECUTION"; }
      }
      releaseMutationIgnore();
      if (superseded()) {
        logV2("replay-hydrate-superseded", { owner: "LEDGER", generation, startingRevision, currentRevision: ledger.cursor });
        return { ok: false, applied, unresolved, failed: failed + 1, failureKind: "LEDGER" };
      }
      ledger.hydratePersisted(toApply);
      const ok = unresolved === 0 && failed === 0;
      logV2("replay", {
        owner: ok ? "LEDGER" : failureKind ?? "LEDGER",
        ok,
        applied,
        unresolved,
        failed,
        total: loaded.length,
      });
      const result: ReplayResult = { ok, applied, unresolved, failed };
      if (!ok && failureKind) {
        return { ...result, failureKind };
      }
      return result;
    },
  };

  overlays.configureToolbar({
    onCommand(commandId) {
      if (commandId === "undo") { runtime.undo(); return; }
      if (commandId === "redo") { runtime.redo(); return; }
      if (commandId === "lasso") {
        if (stylePanelOpen) { stylePanelOpen = false; cancelStylePreview(); overlays.closeStylePanel(); }
        if (textEditorOpen) { textEditorOpen = false; overlays.closeTextEditor(true); }
        overlays.toggleLassoChooser();
        refreshToolbar();
        return;
      }
      if (commandId === "lasso-rectangle") { runtime.armLasso("rectangle"); return; }
      if (commandId === "lasso-freeform") { runtime.armLasso("freeform"); return; }
      if (commandId === "style-panel") {
        overlays.closeLassoChooser();
        stylePanelOpen = !stylePanelOpen;
        if (stylePanelOpen) overlays.openStylePanel(stylePanelValues());
        else { cancelStylePreview(); overlays.closeStylePanel(); }
        refreshToolbar();
        return;
      }
      if (commandId === "text-edit") {
        overlays.closeLassoChooser();
        const selected = singleSelectedElement();
        const surface = selected ? textSurface(selected.element) : null;
        if (!surface) return;
        textEditorOpen = true;
        overlays.openTextEditor(renderedVisibleText(surface));
        refreshToolbar();
        return;
      }
      if (commandId === "crop-mode") {
        overlays.closeLassoChooser();
        cropMode = !cropMode;
        const selected = singleSelectedElement();
        const subject = selected && cropMode ? resolveCropSubject(selected.element) : null;
        overlays.setCropMode(cropMode, subject ? visualModel.adopt(subject) ?? undefined : undefined);
        refreshToolbar();
      }
    },
    onStyleChange(property, value) {
      previewStyle(property, value);
    },
    onStylePanelApply() {
      const pending = new Map(stylePreview?.pending ?? []);
      cancelStylePreview();
      if (pending.size > 0) runtime.styleSelection(pending);
      stylePanelOpen = false;
      refreshToolbar();
    },
    onStylePanelReset() {
      cancelStylePreview();
      return stylePanelValues();
    },
    onStylePanelClose() {
      cancelStylePreview();
      stylePanelOpen = false;
      refreshToolbar();
    },
    onTextCommit(value) {
      runtime.editSelectedText(value);
      textEditorOpen = false;
      refreshToolbar();
    },
    onTextCancel() {
      textEditorOpen = false;
      refreshToolbar();
    },
    onToolbarBackgroundClick(clientX, clientY) {
      const candidate = root.elementsFromPoint(clientX, clientY).find(
        (element): element is HTMLElement => element instanceof HTMLElement && !isExtensionRoot(element),
      );
      if (candidate) runtime.select(candidate);
    },
    onToolbarPointerDown(clientX, clientY) {
      const managed = root.elementsFromPoint(clientX, clientY)
        .filter((element) => !isExtensionRoot(element))
        .map((element) => element.closest<HTMLElement>('[data-otf-managed="true"]'))
        .find((element): element is HTMLElement => Boolean(element));
      if (!managed) return false;
      const managedId = managed.getAttribute("data-otf-clone-id");
      const selectedCloneIds = selectedIds().map((id) => visualModel.bind(id)?.getAttribute("data-otf-clone-id"));
      if (managedId && !selectedCloneIds.includes(managedId)) {
        runtime.select(managed);
        return true;
      }
      return false;
    },
  });

  return runtime;
}
