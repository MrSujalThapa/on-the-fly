import type { DuplicateOperation, EditorOperation, MoveOperation, ResizeOperation, ZIndexOperation } from "../editor/operations.js";
import type { GroupId, VisualNodeId } from "../editor/ids.js";
import { computeDocumentPageKey } from "../content/page-identity.js";
import {
  loadPageOperations,
  replacePageOperations,
} from "../content/storage-client.js";
import { waitForDocumentReady, waitForReplayTargets } from "../editor/dom/replay-readiness.js";
import { OTF_TRANSFORM_ATTR, type StoredTransformState } from "../editor/dom/types.js";
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
import { summarizeIdentity } from "./visual-identity.js";
import { isResolvedVisual } from "./visual-model.js";
import { projectCanonicalCheckpoint } from "./canonical-checkpoint.js";
import { buildDuplicateFromClipboardEntry } from "../editor/duplicate/duplicate-element.js";
import { buildHideOperation, buildMoveOperation, buildResizeOperation, buildRotateOperation } from "../editor/transform/operation-factory.js";
import { applyStoredTransformState, applyStoredTransformStateToRect, readStoredTransformState, writeStoredTransformState } from "../editor/dom/element-snapshot.js";
import { localSizeForRotatedBounds, resizeRectFromCorner, rotatePointAroundCenter, rotatedMemberRect, scaleRects, type ResizeCorner } from "./editor-parity-geometry.js";
import {
  buildLassoSampleGrid,
  LASSO_THRESHOLD_PX,
  meaningfullyIntersects,
  normalizeRect,
} from "./lasso-selection.js";
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

type PointerGesture = MovingGesture | LassoGesture;

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
  kind: "resize-nw" | "resize-ne" | "resize-sw" | "resize-se" | "rotate";
  startPointer: { x: number; y: number };
  startUnion: IntendedRect;
  targets: readonly TransformPreviewTarget[];
  lastPointer: { x: number; y: number };
  rafId: number;
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
  let saveStatus: "idle" | "saving" | "saved" | "failed" = "idle";

  const pageKey = (): string => computeDocumentPageKey(root);

  const refreshSave = (): void => {
    if (ledger.isDirty() && saveStatus === "saved") {
      saveStatus = "idle";
    }
    overlays.setSave({
      visible: ledger.isDirty() || saveStatus !== "idle",
      status: saveStatus,
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
  };

  const setSelection = (next: RuntimeSelection): void => {
    selection = normalizeSelection(next.atoms, groups, next.source);
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

  const reapplyActive = (): void => {
    ignoreMutations = true;
    try {
      for (const operation of ledger.activeOperations()) {
        if (!isMoveOperation(operation) && !isLayerOperation(operation)) {
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
        const resolved = cached && isResolvedVisual(cached)
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
        if (isLayerOperation(operation)) {
          executor.replayLayer(operation);
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
        const result = executor.replayMove(operation);
        logV2("reapply", {
          owner: result.ok ? "EXECUTION" : "EXECUTION",
          ok: result.ok,
          id: operation.id,
          error: result.ok ? undefined : result.error,
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
    overlays.clearLasso();
    overlays.refreshFromLiveGeometry();
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

  const previewTransformAt = (active: TransformGesture, pointer: { x: number; y: number }): void => {
    restoreTransformPreview(active);
    if (active.targets.some((target) => !target.element.isConnected || visualModel.bind(target.nodeId) !== target.element)) return;
    if (active.kind === "rotate") {
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
    if (active.kind === "rotate") {
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
    const roots = effectRoots(selectedIds());
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
    };
    transformGesture = active;
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
    if (active.kind === "lasso") {
      gesture = null;
      overlays.clearLasso();
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
    if (event.key === "Escape") {
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
      if (ignoreMutations || gesture || transformGesture) {
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
      const items: DuplicateOperation[] = [];
      const rootIndex = new Map<VisualNodeId, number>();
      for (const nodeId of roots) {
        const element = visualModel.bind(nodeId);
        const identity = visualModel.durableIdentityOf(nodeId);
        const measured = visualModel.measure([nodeId]).get(nodeId);
        if (!element || !identity || !measured) return false;
        const built = buildDuplicateFromClipboardEntry({
          element,
          target: { nodeId, signature: identity.signature, rect: measured },
        }, pageKey(), `clipboard-${nodeId}`, -1);
        if (!built) return false;
        items.push(JSON.parse(JSON.stringify(built.operation)) as DuplicateOperation);
        rootIndex.set(nodeId, items.length - 1);
      }
      if (items.length === 0) return false;
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
      if (!result.ok) return result;
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
      const result = executor.executeTransaction({ operations });
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
      refreshSave();
      const pending = (async (): Promise<PersistResult> => {
        const active = ledger.activeOperations();
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
        const currentCheckpoint = projectCanonicalCheckpoint(ledger.activeOperations());
        if (
          currentCheckpoint.ok &&
          JSON.stringify(currentCheckpoint.operations) === JSON.stringify(projection)
        ) {
          ledger.markPersisted();
        }
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
      await waitForDocumentReady(root);
      const loaded = await loadPageOperations(pageKey());
      const checkpoint = projectCanonicalCheckpoint(loaded);
      const toApply = checkpoint.ok ? checkpoint.operations : loaded;
      // Reconstruct ancestor-controlled layout before promoting independent
      // children. This keeps parent identities resolvable against the pristine
      // DOM and lets detached children establish their saved world rect last.
      const moves = toApply.filter(isMoveOperation).sort((a, b) =>
        Number(a.payload.detached) - Number(b.payload.detached));
      const layers = toApply.filter(isLayerOperation);
      const duplicates = toApply.filter((operation): operation is DuplicateOperation => operation.type === "duplicate");
      const effects = toApply.filter((operation) => operation.type === "resize" || operation.type === "rotate" || operation.type === "hide");
      if (duplicates.length > 0 && root.readyState !== "complete") {
        await new Promise<void>((resolve) => {
          root.defaultView?.addEventListener("load", () => { resolve(); }, { once: true });
          root.defaultView?.setTimeout(resolve, 2_000);
        });
      }
      const duplicateResults = duplicates.map((operation) => executor.replayOperation(operation));
      await waitForReplayTargets(root, [...moves, ...effects, ...layers], {
        maxFrames: 240,
        canResolve: (operation) => Boolean(
          operation.target.signature &&
          isResolvedVisual(visualModel.resolveIdentity({ signature: operation.target.signature })),
        ),
      });
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
        const result = executor.replayOperation(operation);
        if (result.ok) applied += 1;
        else if (result.error === "unresolved_target" || result.error === "ambiguous_target") { unresolved += 1; failureKind = "IDENTITY"; }
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

  return runtime;
}
