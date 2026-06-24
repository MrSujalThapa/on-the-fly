import type { PageKey, VisualNodeId } from "../editor/ids.js";
import type { EditorOperation } from "../editor/operations.js";
import type { VisualNodeRect } from "../editor/visual-node.js";
import { matchElementBySignature } from "../editor/dom/signature-matcher.js";
import {
  describeZIndexOperation,
  layerCommandToSource,
  logMoveStrategyDiagnostic,
  logZIndexOperationDiagnostic,
} from "../editor/diagnostics/editor-diagnostics.js";
import {
  requiresInteractionSafeFixedMove,
  requiresTransformOnlyMove,
  resolveInteractionMoveTarget,
} from "../editor/dom/interactive-safety.js";
import { resolveLayerPlan } from "../editor/dom/layer-overlap-resolver.js";
import {
  applyInteractionSafeFixedPlacement,
  buildInteractionSafeFixedPayload,
} from "../editor/dom/interactive-fixed-placement.js";
import {
  findCounterTransformDescendants,
  markTransformOnlyMove,
  tryDetachMovedElement,
} from "../editor/dom/managed-detach.js";
import { readStoredTransformState } from "../editor/dom/element-snapshot.js";
import { buildElementSignature } from "../editor/measurement/signature-builder.js";
import { readStoredCropInsets } from "../editor/dom/handlers/crop-handler.js";
import type { DomRuntimeAdapter } from "../editor/dom/dom-runtime-adapter.js";
import { enrichOperationWithRects } from "../editor/dom/enrich-operation-metadata.js";
import { extractBoundingBox } from "../editor/measurement/bounding-box.js";
import { measurementRectToAffectedRect } from "../editor/save-window/operation-metadata.js";
import {
  angleForPointer,
  applyCropToRect,
  buildCropOperation,
  buildHideOperation,
  buildMoveOperation,
  buildResizeOperation,
  buildRotateOperation,
  buildZIndexOperation,
  computeCrop,
  computeResize,
  cropInsetsToClipPath,
  isResizeHandleId,
  rectCenterPoint,
  snapDegrees,
  type CropInsets,
  type LayerCommand,
  type ResizeHandleId,
  type TransformTarget,
} from "../editor/transform/index.js";
import { computeUnionRect } from "../editor/selection/virtual-group.js";
import type {
  EditorShell,
  SelectionOutlineVariant,
  TransformHandleId,
} from "./editor-shell.js";

export interface TransformSelectionInput {
  targets: TransformTarget[];
  outlineRects: VisualNodeRect[];
  variant: SelectionOutlineVariant;
  handleTarget: TransformTarget | null;
}

export interface TransformControllerOptions {
  shell: EditorShell;
  document: Document;
  adapter: DomRuntimeAdapter;
  getPageKey: () => PageKey;
  onApply?: (operations: EditorOperation[]) => void;
  onDebug?: (message: string, data?: unknown) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  onGeometryChanged?: () => void;
  onFrame?: (durationMs: number, phase: "transform") => void;
}

interface InlineSnapshot {
  transform: string;
  width: string;
  height: string;
}

interface MoveDragState {
  startX: number;
  startY: number;
  elements: { element: HTMLElement; snapshot: InlineSnapshot; baseDx: number; baseDy: number; baseRotate: number }[];
  counterElements: {
    element: HTMLElement;
    snapshot: InlineSnapshot;
    baseDx: number;
    baseDy: number;
    baseRotate: number;
  }[];
}

interface ResizeDragState {
  element: HTMLElement;
  handle: ResizeHandleId;
  startX: number;
  startY: number;
  startRect: VisualNodeRect;
  snapshot: InlineSnapshot;
  baseDx: number;
  baseDy: number;
  baseRotate: number;
}

interface RotateDragState {
  element: HTMLElement;
  startRect: VisualNodeRect;
  snapshot: InlineSnapshot;
  baseDx: number;
  baseDy: number;
  shiftKey: boolean;
}

interface CropDragState {
  element: HTMLElement;
  handle: ResizeHandleId;
  pointerId: number;
  captureTarget: Element | null;
  timeoutId: number | null;
  startX: number;
  startY: number;
  startRect: VisualNodeRect;
  baseInsets: CropInsets;
  clipSnapshot: ClipSnapshot;
}

interface ClipSnapshot {
  clipPath: string;
  webkitClipPath: string;
}

const ROTATE_SNAP_DEGREES = 15;
const CROP_STUCK_TIMEOUT_MS = 12000;
const GIANT_TARGET_VIEWPORT_AREA_RATIO = 0.65;
const GIANT_TARGET_VIEWPORT_HEIGHT_RATIO = 1.25;

export class TransformController {
  private readonly shell: EditorShell;
  private readonly document: Document;
  private readonly adapter: DomRuntimeAdapter;
  private readonly getPageKey: () => PageKey;
  private readonly onApply: ((operations: EditorOperation[]) => void) | undefined;
  private readonly onDebug: (message: string, data?: unknown) => void;
  private readonly onInteractionStart: (() => void) | undefined;
  private readonly onInteractionEnd: (() => void) | undefined;
  private readonly onGeometryChanged: (() => void) | undefined;
  private readonly onFrame: ((durationMs: number, phase: "transform") => void) | undefined;
  private interactionDepth = 0;

  private selection: TransformSelectionInput | null = null;
  /**
   * Active selection element registry: live DOM element references for the
   * current selection, keyed by node id. Lets in-session transforms apply to
   * the exact selected element (DOM-first selection) instead of depending on
   * signature re-resolution, which can fail or match a child for cards/wrappers.
   */
  private readonly elementRegistry = new Map<VisualNodeId, HTMLElement>();
  private moveDrag: MoveDragState | null = null;
  private resizeDrag: ResizeDragState | null = null;
  private rotateDrag: RotateDragState | null = null;
  private cropDrag: CropDragState | null = null;
  private cropModeEnabled = false;
  private handleWindowListeners: (() => void) | null = null;
  private rafId: number | null = null;
  private pendingTask: (() => void) | null = null;

  constructor(options: TransformControllerOptions) {
    this.shell = options.shell;
    this.document = options.document;
    this.adapter = options.adapter;
    this.getPageKey = options.getPageKey;
    this.onApply = options.onApply;
    this.onDebug = options.onDebug ?? (() => undefined);
    this.onInteractionStart = options.onInteractionStart;
    this.onInteractionEnd = options.onInteractionEnd;
    this.onGeometryChanged = options.onGeometryChanged;
    this.onFrame = options.onFrame;
    this.shell.setHandlePointerDownHandler((handleId, event) => {
      this.handleHandlePointerDown(handleId, event);
    });
  }

  setSelection(input: TransformSelectionInput | null): void {
    if (this.isTransforming()) {
      this.cancelActiveTransform();
    }
    this.selection = input;
    this.rebuildElementRegistry();
    this.renderSelection();
  }

  clearSelection(): void {
    this.cancelActiveDrag();
    this.selection = null;
    this.elementRegistry.clear();
  }

  hasSelection(): boolean {
    return this.selection !== null && this.selection.targets.length > 0;
  }

  getSelection(): TransformSelectionInput | null {
    return this.selection;
  }

  getTargets(): TransformTarget[] {
    return this.selection?.targets ?? [];
  }

  getHandleTarget(): TransformTarget | null {
    return this.selection?.handleTarget ?? null;
  }

  setCropMode(enabled: boolean): boolean {
    if (!enabled) {
      if (this.cropDrag) {
        this.cancelCropDrag();
        this.detachHandleWindowListeners();
      }
      this.cropModeEnabled = false;
      return false;
    }

    if (!this.canCropSelection()) {
      this.cropModeEnabled = false;
      this.onDebug("transform-crop-disabled", {
        reason: this.cropDisabledReason(),
      });
      return false;
    }

    this.cropModeEnabled = true;
    return true;
  }

  isCropMode(): boolean {
    return this.cropModeEnabled;
  }

  toggleCropMode(): boolean {
    return this.setCropMode(!this.cropModeEnabled);
  }

  canCropSelection(): boolean {
    return this.cropDisabledReason() === null;
  }

  isTransforming(): boolean {
    return (
      this.moveDrag !== null ||
      this.resizeDrag !== null ||
      this.rotateDrag !== null ||
      this.cropDrag !== null
    );
  }

  cancelActiveTransform(): void {
    this.cancelActiveDrag();
  }

  hitTestSelection(x: number, y: number): boolean {
    if (!this.selection) {
      return false;
    }
    return this.selection.outlineRects.some((rect) => pointInRect(x, y, rect));
  }

  dispose(): void {
    this.cancelActiveDrag();
    this.shell.setHandlePointerDownHandler(null);
    this.cancelScheduledFrame();
  }

  // --- Move (5A) ---

  beginMove(x: number, y: number): boolean {
    if (!this.selection || this.selection.targets.length === 0) {
      return false;
    }

    const elements = this.selection.targets
      .map((target) => {
        const element = this.resolveElement(target);
        if (element) {
          this.onDebug("transform-target", {
            phase: "move",
            selected: describeSignature(target),
            target: describeElement(element),
            moveTarget: describeElement(resolveInteractionMoveTarget(element)),
          });
        }
        const moveElement = element ? resolveInteractionMoveTarget(element) : null;
        if (!moveElement) {
          return null;
        }
        const stored = readStoredTransformState(moveElement);
        return {
          element: moveElement,
          snapshot: captureInlineSnapshot(moveElement),
          baseDx: stored?.dx ?? 0,
          baseDy: stored?.dy ?? 0,
          baseRotate: stored?.rotate ?? 0,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (elements.length === 0) {
      this.onDebug("transform-move-no-target", {
        targets: this.selection.targets.map((target) => describeSignature(target)),
      });
      return false;
    }

    const excluded = new Set(elements.map((entry) => entry.element));
    const counterElements: MoveDragState["counterElements"] = [];
    for (const entry of elements) {
      for (const descendant of findCounterTransformDescendants(entry.element, excluded)) {
        if (counterElements.some((counter) => counter.element === descendant)) {
          continue;
        }
        const stored = readStoredTransformState(descendant);
        counterElements.push({
          element: descendant,
          snapshot: captureInlineSnapshot(descendant),
          baseDx: stored?.dx ?? 0,
          baseDy: stored?.dy ?? 0,
          baseRotate: stored?.rotate ?? 0,
        });
      }
    }

    this.moveDrag = { startX: x, startY: y, elements, counterElements };
    this.notifyInteractionStart();
    this.onDebug("transform-move-start", { count: elements.length });
    return true;
  }

  updateMove(x: number, y: number): void {
    const drag = this.moveDrag;
    if (!drag) {
      return;
    }

    const dx = x - drag.startX;
    const dy = y - drag.startY;
    this.scheduleFrame(() => {
      const moved = new Set<HTMLElement>();
      for (const entry of drag.elements) {
        if (moved.has(entry.element)) {
          continue;
        }
        moved.add(entry.element);
        entry.element.style.transform = composeTransform(
          entry.baseDx + dx,
          entry.baseDy + dy,
          entry.baseRotate,
        );
      }
      for (const entry of drag.counterElements) {
        entry.element.style.transform = composeTransform(
          entry.baseDx - dx,
          entry.baseDy - dy,
          entry.baseRotate,
        );
      }
      this.shell.translateOverlay(dx, dy);
    });
  }

  endMove(x: number, y: number): EditorOperation[] {
    const drag = this.moveDrag;
    this.moveDrag = null;
    if (drag) {
      this.notifyInteractionEnd();
    }
    if (!drag) {
      return [];
    }

    this.cancelScheduledFrame();
    const dx = x - drag.startX;
    const dy = y - drag.startY;

    for (const entry of drag.elements) {
      restoreInlineSnapshot(entry.element, entry.snapshot);
    }
    for (const entry of drag.counterElements) {
      restoreInlineSnapshot(entry.element, entry.snapshot);
    }

    if (dx === 0 && dy === 0) {
      this.renderSelection();
      return [];
    }

    const pageKey = this.getPageKey();
    const operations: EditorOperation[] = (this.selection?.targets ?? []).map((target) =>
      buildMoveOperation(target, dx, dy, { pageKey }),
    );

    const excluded = new Set(drag.elements.map((entry) => entry.element));
    const compensated = new Set<HTMLElement>();
    for (const entry of drag.elements) {
      for (const descendant of findCounterTransformDescendants(entry.element, excluded)) {
        if (compensated.has(descendant)) {
          continue;
        }
        compensated.add(descendant);
        operations.push(
          buildMoveOperation(targetFromLiveElement(descendant, this.document), -dx, -dy, {
            pageKey,
          }),
        );
      }
    }

    const coMoved = [...new Set(drag.elements.map((entry) => entry.element))];
    const operationElements: HTMLElement[] = [];
    for (const operation of operations) {
      const nodeId = operation.target.nodeId;
      const override = nodeId ? this.elementRegistry.get(nodeId) ?? null : null;
      const resolved =
        override?.isConnected
          ? override
          : operation.target.signature
            ? matchElementBySignature(this.document, operation.target.signature)
            : null;
      const element = resolved ? resolveInteractionMoveTarget(resolved) : null;
      if (element) {
        operationElements.push(element);
      }
    }

    const originalRects = operationElements.map((element) =>
      measurementRectToAffectedRect(extractBoundingBox(element)),
    );
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const element = operationElements[index];
      if (!operation || !element) {
        continue;
      }
      const result = this.adapter.applyOperation(operation, element);
      if (!result.ok) {
        this.onDebug("transform-apply-failed", { code: result.code, error: result.error });
      }
    }

    // Capture every moved element's final geometry now, while all elements are
    // still in flow with their transforms applied. Detaching one element below
    // reparents it to <body> and reflows its siblings, so measuring afterwards
    // would record reflowed (wrong) positions and make grouped elements overlap.
    const finalRects = operationElements.map((element) =>
      measurementRectToAffectedRect(extractBoundingBox(element)),
    );
    const finalRectByElement = new Map(
      operationElements.map((element, index) => [element, finalRects[index]] as const),
    );
    const originalRectByElement = new Map(
      operationElements.map((element, index) => [element, originalRects[index]] as const),
    );

    const primaryCount = this.selection?.targets.length ?? 0;
    const processedMoveElements = new Set<HTMLElement>();
    for (let index = 0; index < primaryCount; index += 1) {
      const entry = drag.elements[index];
      const operation = operations[index];
      if (!entry || operation?.type !== "move") {
        continue;
      }
      if (processedMoveElements.has(entry.element)) {
        operation.payload = {
          ...operation.payload,
          transformOnly: true,
          interactionSafeFixed: false,
          detached: false,
        };
        continue;
      }
      processedMoveElements.add(entry.element);

      const finalRect = finalRectByElement.get(entry.element);

      if (requiresInteractionSafeFixedMove(entry.element)) {
        if (finalRect) {
          applyInteractionSafeFixedPlacement(
            entry.element,
            finalRect,
            this.adapter.getSnapshotStore(),
          );
          operation.payload = buildInteractionSafeFixedPayload(operation, finalRect, entry.element);
        }
        logMoveStrategyDiagnostic(
          this.onDebug,
          entry.element,
          operation.id,
          "interaction-safe-fixed",
          false,
        );
        continue;
      }

      if (requiresTransformOnlyMove(entry.element)) {
        markTransformOnlyMove(entry.element);
        operation.payload = {
          ...operation.payload,
          transformOnly: true,
          interactionSafeFixed: false,
          detached: false,
        };
        logMoveStrategyDiagnostic(
          this.onDebug,
          entry.element,
          operation.id,
          "transform-only",
          false,
        );
        continue;
      }

      const placement = tryDetachMovedElement(entry.element, coMoved, finalRectByElement.get(entry.element));
      if (!placement) {
        logMoveStrategyDiagnostic(
          this.onDebug,
          entry.element,
          operation.id,
          "in-flow",
          false,
        );
        continue;
      }

      operation.payload = {
        ...operation.payload,
        detached: true,
        transformOnly: false,
        detachedLeft: placement.left,
        detachedTop: placement.top,
        ...(placement.zIndex && placement.zIndex !== "auto"
          ? { detachedZIndex: placement.zIndex }
          : {}),
      };
      logMoveStrategyDiagnostic(this.onDebug, entry.element, operation.id, "detached", true);
    }

    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const element = operationElements[index];
      if (!operation || !element) {
        continue;
      }
      const originalRect = originalRectByElement.get(element);
      const finalRect = finalRectByElement.get(element);
      if (!originalRect || !finalRect) {
        continue;
      }
      operations[index] = enrichOperationWithRects(operation, originalRect, finalRect);
    }

    if (operations.length > 0) {
      this.onApply?.(operations);
    }
    this.refreshOutlineFromDom();
    this.onGeometryChanged?.();
    this.onDebug("transform-move-commit", { dx, dy, count: operations.length });
    return operations;
  }

  cancelMove(): void {
    const drag = this.moveDrag;
    this.moveDrag = null;
    if (drag) {
      this.notifyInteractionEnd();
    }
    if (!drag) {
      return;
    }
    this.cancelScheduledFrame();
    for (const entry of drag.elements) {
      restoreInlineSnapshot(entry.element, entry.snapshot);
    }
    for (const entry of drag.counterElements) {
      restoreInlineSnapshot(entry.element, entry.snapshot);
    }
    this.renderSelection();
  }

  // --- Layering (5C) ---

  applyLayerCommand(command: LayerCommand): EditorOperation[] {
    const targets = this.selection?.targets ?? [];
    if (targets.length === 0) {
      return [];
    }

    const pageKey = this.getPageKey();
    const operations: EditorOperation[] = [];
    const elements: HTMLElement[] = [];
    for (const target of targets) {
      const element = this.resolveElement(target);
      if (!element) {
        this.onDebug("transform-layer-skip", {
          reason: "target-not-resolved",
          selected: describeSignature(target),
        });
        continue;
      }

      const plan = resolveLayerPlan(element, command, this.adapter.getSnapshotStore(), {
        onDebug: this.onDebug,
      });
      const sourceCommand = layerCommandToSource(command);
      const operation = buildZIndexOperation(
        targetFromLiveElement(element, this.document),
        plan.layer,
        plan.previousLayer,
        { pageKey, sourceCommand },
        element,
      );
      logZIndexOperationDiagnostic(this.onDebug, {
        ...describeZIndexOperation(operation, "created", { sourceCommand }),
      });
      this.onDebug("transform-target", {
        phase: "layer",
        command,
        selected: describeSignature(target),
        target: describeElement(plan.host),
        currentLayer: plan.previousLayer,
        nextLayer: plan.layer,
        reason: plan.reason ?? plan.diagnostic.reason ?? describeStackingRisk(plan.host),
        verification: plan.verification,
        selectedHostDiffersFromSelected: plan.host !== element,
      });
      operations.push(operation);
      elements.push(element);
    }

    if (operations.length === 0) {
      return [];
    }

    const applied = this.applyOperations(operations, { elements });
    this.refreshOutlineFromDom();
    this.onGeometryChanged?.();
    this.onDebug("transform-layer", { command, count: applied.length });
    return applied;
  }

  // --- Hide / show (5C) ---

  /** Hides the current selection (Delete/Backspace). Reversible via undo/replay. */
  hideSelection(): EditorOperation[] {
    return this.applyHideToTargets(true);
  }

  /** Toggles hidden state for the current selection (Ctrl+Shift+H). */
  toggleHideSelection(): EditorOperation[] {
    return this.applyHideToTargets(!this.isSelectionHidden());
  }

  private isSelectionHidden(): boolean {
    const targets = this.selection?.targets ?? [];
    if (targets.length === 0) {
      return false;
    }

    return targets.every((target) => {
      const element = this.resolveElement(target);
      return element ? isElementHidden(element) : false;
    });
  }

  private applyHideToTargets(hidden: boolean): EditorOperation[] {
    const targets = this.selection?.targets ?? [];
    if (targets.length === 0) {
      return [];
    }

    const pageKey = this.getPageKey();
    const operations: EditorOperation[] = [];
    for (const target of targets) {
      const element = this.resolveElement(target);
      if (!element) {
        continue;
      }

      const alreadyHidden = isElementHidden(element);
      if (hidden && alreadyHidden) {
        this.onDebug("transform-hide-skip", {
          reason: "already-hidden",
          selected: describeSignature(target),
        });
        continue;
      }
      if (!hidden && !alreadyHidden) {
        this.onDebug("transform-hide-skip", {
          reason: "already-visible",
          selected: describeSignature(target),
        });
        continue;
      }

      const previousDisplay = element.style.display || readComputedDisplay(element);
      operations.push(
        buildHideOperation(
          target,
          hidden,
          { pageKey },
          hidden ? previousDisplay : undefined,
          element,
        ),
      );
    }

    if (operations.length === 0) {
      return [];
    }

    this.applyOperations(operations);
    if (hidden) {
      this.shell.clearOverlays();
    } else {
      this.refreshOutlineFromDom();
    }
    this.onDebug("transform-hide", { hidden, count: operations.length });
    return operations;
  }

  // --- Crop (5C) ---

  /**
   * Crops the single handle target to the given insets (px from each edge).
   * Crop clips the visible region without resizing/distorting the content.
   */
  cropSelection(insets: CropInsets): EditorOperation[] {
    const target = this.selection?.handleTarget;
    if (!target) {
      return [];
    }

    const element = this.resolveElement(target);
    if (!element) {
      return [];
    }

    const operation = buildCropOperation(target, insets, { pageKey: this.getPageKey() });
    this.applyOperations([operation]);
    this.refreshOutlineFromDom();
    this.onDebug("transform-crop-commit", { insets });
    return [operation];
  }

  // --- Resize + rotate (5B) ---

  private handleHandlePointerDown(handleId: TransformHandleId, event: PointerEvent): void {
    const handleTarget = this.selection?.handleTarget;
    if (!handleTarget) {
      return;
    }

    const element = this.resolveElement(handleTarget);
    if (!element) {
      this.onDebug("transform-resize-no-target", {
        selected: describeSignature(handleTarget),
      });
      return;
    }

    this.onDebug("transform-target", {
      phase: handleId === "rotate" ? "rotate" : "resize",
      handleId,
      selected: describeSignature(handleTarget),
      target: describeElement(element),
    });

    const startRect = currentRect(element);
    const stored = readStoredTransformState(element);
    const snapshot = captureInlineSnapshot(element);

    if (handleId === "rotate") {
      this.rotateDrag = {
        element,
        startRect,
        snapshot,
        baseDx: stored?.dx ?? 0,
        baseDy: stored?.dy ?? 0,
        shiftKey: event.shiftKey,
      };
    } else if (isResizeHandleId(handleId) && this.cropModeEnabled) {
      const disabledReason = this.cropDisabledReason();
      if (disabledReason) {
        this.cropModeEnabled = false;
        this.onDebug("transform-crop-disabled", { reason: disabledReason });
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const captureTarget = event.target instanceof Element ? event.target : null;
      capturePointer(captureTarget, event.pointerId);
      this.cropDrag = {
        element,
        handle: handleId,
        pointerId: event.pointerId,
        captureTarget,
        timeoutId: this.document.defaultView?.setTimeout(() => {
          this.onDebug("transform-crop-timeout", { pointerId: event.pointerId });
          this.cancelCropDrag();
        }, CROP_STUCK_TIMEOUT_MS) ?? null,
        startX: event.clientX,
        startY: event.clientY,
        startRect,
        baseInsets: readStoredCropInsets(element),
        clipSnapshot: captureClipSnapshot(element),
      };
    } else if (isResizeHandleId(handleId)) {
      if (isGiantTransformTarget(startRect, this.document)) {
        this.onDebug("transform-resize-disabled", { reason: "giant-target" });
        return;
      }
      this.resizeDrag = {
        element,
        handle: handleId,
        startX: event.clientX,
        startY: event.clientY,
        startRect,
        snapshot,
        baseDx: stored?.dx ?? 0,
        baseDy: stored?.dy ?? 0,
        baseRotate: stored?.rotate ?? 0,
      };
    } else {
      return;
    }

    this.notifyInteractionStart();
    this.attachHandleWindowListeners();
  }

  private updateResize(x: number, y: number): void {
    const drag = this.resizeDrag;
    if (!drag) {
      return;
    }

    const result = computeResize(drag.startRect, drag.handle, x - drag.startX, y - drag.startY);
    this.scheduleFrame(() => {
      drag.element.style.width = `${String(result.width)}px`;
      drag.element.style.height = `${String(result.height)}px`;
      drag.element.style.transform = composeTransform(
        drag.baseDx + result.dx,
        drag.baseDy + result.dy,
        drag.baseRotate,
      );
      this.renderOutlineRect({
        x: drag.startRect.x + result.dx,
        y: drag.startRect.y + result.dy,
        width: result.width,
        height: result.height,
      });
    });
  }

  private endResize(x: number, y: number): EditorOperation[] {
    const drag = this.resizeDrag;
    this.resizeDrag = null;
    if (drag) {
      this.notifyInteractionEnd();
    }
    if (!drag) {
      return [];
    }

    this.cancelScheduledFrame();
    const target = this.selection?.handleTarget;
    restoreInlineSnapshot(drag.element, drag.snapshot);
    if (!target) {
      this.renderSelection();
      return [];
    }

    const result = computeResize(drag.startRect, drag.handle, x - drag.startX, y - drag.startY);
    const pageKey = this.getPageKey();
    const operations: EditorOperation[] = [
      buildResizeOperation(target, { width: result.width, height: result.height, mode: "box" }, { pageKey }),
    ];
    if (result.dx !== 0 || result.dy !== 0) {
      operations.push(buildMoveOperation(target, result.dx, result.dy, { pageKey }));
    }

    const enriched = this.applyOperations(operations, { elements: operations.map(() => drag.element) });
    this.refreshOutlineFromDom();
    this.onDebug("transform-resize-commit", {
      width: result.width,
      height: result.height,
    });
    return enriched;
  }

  private updateRotate(x: number, y: number): void {
    const drag = this.rotateDrag;
    if (!drag) {
      return;
    }

    const degrees = this.rotationForPointer(drag, x, y);
    this.scheduleFrame(() => {
      drag.element.style.transform = composeTransform(drag.baseDx, drag.baseDy, degrees);
    });
  }

  private endRotate(x: number, y: number): EditorOperation[] {
    const drag = this.rotateDrag;
    this.rotateDrag = null;
    if (drag) {
      this.notifyInteractionEnd();
    }
    if (!drag) {
      return [];
    }

    this.cancelScheduledFrame();
    const target = this.selection?.handleTarget;
    restoreInlineSnapshot(drag.element, drag.snapshot);
    if (!target) {
      this.renderSelection();
      return [];
    }

    const degrees = this.rotationForPointer(drag, x, y);
    const pageKey = this.getPageKey();
    const operations: EditorOperation[] = [buildRotateOperation(target, degrees, { pageKey })];

    this.applyOperations(operations);
    this.refreshOutlineFromDom();
    this.onDebug("transform-rotate-commit", { degrees });
    return operations;
  }

  private updateCrop(x: number, y: number): void {
    const drag = this.cropDrag;
    if (!drag) {
      return;
    }

    const insets = computeCrop(drag.startRect, drag.handle, drag.baseInsets, x - drag.startX, y - drag.startY);
    this.scheduleFrame(() => {
      const clipPath = cropInsetsToClipPath(insets);
      drag.element.style.clipPath = clipPath;
      drag.element.style.setProperty("-webkit-clip-path", clipPath);
      this.renderOutlineRect(applyCropToRect(drag.startRect, insets));
    });
  }

  private endCrop(x: number, y: number): EditorOperation[] {
    const drag = this.cropDrag;
    this.cropDrag = null;
    if (drag) {
      this.notifyInteractionEnd();
    }
    if (!drag) {
      return [];
    }

    this.cropModeEnabled = false;
    this.clearCropDragResources(drag);
    this.cancelScheduledFrame();
    restoreClipSnapshot(drag.element, drag.clipSnapshot);

    const target = this.selection?.handleTarget;
    if (!target) {
      this.renderSelection();
      return [];
    }

    const insets = computeCrop(drag.startRect, drag.handle, drag.baseInsets, x - drag.startX, y - drag.startY);
    return this.cropSelection(insets);
  }

  private rotationForPointer(drag: RotateDragState, x: number, y: number): number {
    const center = rectCenterPoint(drag.startRect);
    const raw = angleForPointer(center, { x, y });
    return drag.shiftKey ? snapDegrees(raw, ROTATE_SNAP_DEGREES) : raw;
  }

  // --- Shared helpers ---

  private cancelActiveDrag(): void {
    this.cancelMove();
    if (this.resizeDrag) {
      restoreInlineSnapshot(this.resizeDrag.element, this.resizeDrag.snapshot);
      this.resizeDrag = null;
      this.notifyInteractionEnd();
    }
    if (this.rotateDrag) {
      restoreInlineSnapshot(this.rotateDrag.element, this.rotateDrag.snapshot);
      this.rotateDrag = null;
      this.notifyInteractionEnd();
    }
    if (this.cropDrag) {
      this.cancelCropDrag();
    }
    this.detachHandleWindowListeners();
    this.cancelScheduledFrame();
  }

  private cancelCropDrag(): void {
    const drag = this.cropDrag;
    this.cropDrag = null;
    this.cropModeEnabled = false;
    if (!drag) {
      return;
    }

    this.notifyInteractionEnd();
    this.clearCropDragResources(drag);
    this.cancelScheduledFrame();
    restoreClipSnapshot(drag.element, drag.clipSnapshot);
    this.renderSelection();
  }

  private clearCropDragResources(drag: CropDragState): void {
    if (drag.timeoutId !== null) {
      this.document.defaultView?.clearTimeout(drag.timeoutId);
    }
    releasePointer(drag.captureTarget, drag.pointerId);
  }

  private cropDisabledReason(): string | null {
    const selection = this.selection;
    if (!selection || selection.targets.length === 0) {
      return "no-selection";
    }

    if (selection.variant === "group") {
      return "group-selection";
    }

    if (selection.targets.length !== 1 || !selection.handleTarget) {
      return "multi-selection";
    }

    const element = this.resolveElement(selection.handleTarget);
    const rect = element ? currentRect(element) : selection.handleTarget.rect;
    if (isGiantTransformTarget(rect, this.document)) {
      return "giant-target";
    }

    return null;
  }

  private attachHandleWindowListeners(): void {
    if (this.handleWindowListeners) {
      return;
    }

    const view = this.document.defaultView;
    if (!view) {
      return;
    }

    const onMove = (event: PointerEvent): void => {
      if (this.resizeDrag) {
        this.updateResize(event.clientX, event.clientY);
      } else if (this.rotateDrag) {
        this.updateRotate(event.clientX, event.clientY);
      } else if (this.cropDrag && event.pointerId === this.cropDrag.pointerId) {
        this.updateCrop(event.clientX, event.clientY);
      }
    };
    const onUp = (event: PointerEvent): void => {
      if (event.type === "pointercancel") {
        this.cancelActiveDrag();
        return;
      }

      if (this.resizeDrag) {
        this.endResize(event.clientX, event.clientY);
      } else if (this.rotateDrag) {
        this.endRotate(event.clientX, event.clientY);
      } else if (this.cropDrag && event.pointerId === this.cropDrag.pointerId) {
        this.endCrop(event.clientX, event.clientY);
      }
      this.detachHandleWindowListeners();
    };
    const onBlur = (): void => {
      if (this.isTransforming()) {
        this.cancelActiveDrag();
      }
    };

    const moveListener = onMove as EventListener;
    const upListener = onUp as EventListener;
    const blurListener = onBlur as EventListener;
    view.addEventListener("pointermove", moveListener, true);
    view.addEventListener("pointerup", upListener, true);
    view.addEventListener("pointercancel", upListener, true);
    view.addEventListener("blur", blurListener, true);

    this.handleWindowListeners = () => {
      view.removeEventListener("pointermove", moveListener, true);
      view.removeEventListener("pointerup", upListener, true);
      view.removeEventListener("pointercancel", upListener, true);
      view.removeEventListener("blur", blurListener, true);
    };
  }

  private detachHandleWindowListeners(): void {
    this.handleWindowListeners?.();
    this.handleWindowListeners = null;
  }

  private applyOperations(
    operations: EditorOperation[],
    options: { elements?: HTMLElement[] } = {},
  ): EditorOperation[] {
    const elements = options.elements ?? [];
    const enriched: EditorOperation[] = [];

    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      if (!operation) {
        continue;
      }
      let element = elements[index] ?? null;
      if (!element) {
        const nodeId = operation.target.nodeId;
        const override = nodeId ? this.elementRegistry.get(nodeId) ?? null : null;
        element =
          override?.isConnected
            ? override
            : operation.target.signature
              ? matchElementBySignature(this.document, operation.target.signature)
              : null;
      }
      const result = this.adapter.applyOperation(
        operation,
        element?.isConnected ? element : null,
      );
      if (!result.ok) {
        this.onDebug("transform-apply-failed", { code: result.code, error: result.error });
        continue;
      }

      if (element) {
        const rect = measurementRectToAffectedRect(extractBoundingBox(element));
        enriched.push(enrichOperationWithRects(operation, rect, rect));
      } else {
        enriched.push(operation);
      }
    }

    if (enriched.length > 0) {
      this.onApply?.(enriched);
    }

    return enriched;
  }

  /**
   * Resolves the live element for a target, preferring the active-session
   * element reference (DOM-first selection) and only falling back to signature
   * re-resolution when the reference is gone (e.g. SPA re-render).
   */
  private resolveElement(target: TransformTarget): HTMLElement | null {
    if (target.element?.isConnected) {
      return target.element;
    }

    const registered = this.elementRegistry.get(target.nodeId);
    if (registered?.isConnected) {
      return registered;
    }

    return matchElementBySignature(this.document, target.signature);
  }

  private rebuildElementRegistry(): void {
    this.elementRegistry.clear();
    if (!this.selection) {
      return;
    }

    for (const target of this.selection.targets) {
      const element = this.resolveElement(target);
      if (element) {
        this.elementRegistry.set(target.nodeId, element);
      }
    }
  }

  private renderSelection(): void {
    if (!this.selection || this.selection.outlineRects.length === 0) {
      this.shell.clearOverlays();
      return;
    }

    this.shell.clearOverlayTranslate();
    const rects = this.computeVisibleSelectionRects();
    this.selection.outlineRects = rects;
    this.shell.renderSelectionOutlines(rects, this.selection.variant, {
      handles: this.selection.handleTarget !== null,
    });
  }

  private renderOutlineRect(rect: VisualNodeRect): void {
    if (!this.selection) {
      return;
    }
    this.shell.clearOverlayTranslate();
    this.shell.renderSelectionOutlines([rect], this.selection.variant, {
      handles: this.selection.handleTarget !== null,
    });
  }

  /** Re-measures live elements after a transform so the outline tracks them. */
  refreshSelectionOutline(): void {
    this.refreshOutlineFromDom();
  }

  private refreshOutlineFromDom(): void {
    if (!this.selection) {
      return;
    }

    const memberRects: VisualNodeRect[] = [];
    for (const target of this.selection.targets) {
      const element = this.resolveElement(target);
      if (element) {
        const rect = currentRect(element);
        target.rect = rect;
        memberRects.push(visibleRectForElement(element, rect));
      }
    }

    if (memberRects.length === 0) {
      this.renderSelection();
      return;
    }

    this.selection.outlineRects =
      this.selection.variant === "group" ? [computeUnionRect(memberRects)] : memberRects;

    if (this.selection.handleTarget) {
      const element = this.resolveElement(this.selection.handleTarget);
      if (element) {
        const rect = currentRect(element);
        this.selection.handleTarget.rect = visibleRectForElement(element, rect);
      }
    }

    this.renderSelection();
  }

  private computeVisibleSelectionRects(): VisualNodeRect[] {
    if (!this.selection) {
      return [];
    }

    const memberRects: VisualNodeRect[] = [];
    for (const target of this.selection.targets) {
      const element = this.resolveElement(target);
      if (!element) {
        memberRects.push({ ...target.rect });
        continue;
      }
      memberRects.push(visibleRectForElement(element, currentRect(element)));
    }

    if (memberRects.length === 0) {
      return this.selection.outlineRects.map((rect) => ({ ...rect }));
    }

    return this.selection.variant === "group" ? [computeUnionRect(memberRects)] : memberRects;
  }

  private scheduleFrame(task: () => void): void {
    const view = this.document.defaultView;
    if (!view || typeof view.requestAnimationFrame !== "function") {
      const startedAt = performance.now();
      task();
      this.onFrame?.(performance.now() - startedAt, "transform");
      return;
    }

    this.pendingTask = task;
    if (this.rafId !== null) {
      return;
    }

    this.rafId = view.requestAnimationFrame(() => {
      const startedAt = performance.now();
      this.rafId = null;
      const pending = this.pendingTask;
      this.pendingTask = null;
      pending?.();
      this.onFrame?.(performance.now() - startedAt, "transform");
    });
  }

  private notifyInteractionStart(): void {
    if (this.interactionDepth === 0) {
      this.onInteractionStart?.();
    }
    this.interactionDepth += 1;
  }

  private notifyInteractionEnd(): void {
    if (this.interactionDepth === 0) {
      return;
    }
    this.interactionDepth -= 1;
    if (this.interactionDepth === 0) {
      this.onInteractionEnd?.();
    }
  }

  private cancelScheduledFrame(): void {
    const view = this.document.defaultView;
    if (this.rafId !== null && view && typeof view.cancelAnimationFrame === "function") {
      view.cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    this.pendingTask = null;
  }
}

export function createTransformController(
  options: TransformControllerOptions,
): TransformController {
  return new TransformController(options);
}

function pointInRect(x: number, y: number, rect: VisualNodeRect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function composeTransform(dx: number, dy: number, rotate: number): string {
  return `translate(${String(dx)}px, ${String(dy)}px) rotate(${String(rotate)}deg)`;
}

function targetFromLiveElement(element: HTMLElement, document: Document): TransformTarget {
  const rect = element.getBoundingClientRect();
  const viewport = document.defaultView
    ? { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
    : undefined;
  const signature = buildElementSignature(element, {
    root: document,
    ...(viewport ? { viewport } : {}),
  });
  const cloneId = element.getAttribute("data-otf-clone-id");

  return {
    nodeId: cloneId ?? signature.cssPath,
    signature,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    element,
  };
}

function currentRect(element: HTMLElement): VisualNodeRect {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function visibleRectForElement(element: HTMLElement, rect: VisualNodeRect): VisualNodeRect {
  return applyCropToRect(rect, readStoredCropInsets(element));
}

function captureInlineSnapshot(element: HTMLElement): InlineSnapshot {
  return {
    transform: element.style.transform,
    width: element.style.width,
    height: element.style.height,
  };
}

function captureClipSnapshot(element: HTMLElement): ClipSnapshot {
  return {
    clipPath: element.style.clipPath,
    webkitClipPath: element.style.getPropertyValue("-webkit-clip-path"),
  };
}

function restoreClipSnapshot(element: HTMLElement, snapshot: ClipSnapshot): void {
  setOrRemove(element, "clip-path", snapshot.clipPath);
  setOrRemove(element, "-webkit-clip-path", snapshot.webkitClipPath);
}

function isElementHidden(element: HTMLElement): boolean {
  if (element.style.display === "none") {
    return true;
  }
  return readComputedDisplay(element) === "none";
}

function readComputedDisplay(element: HTMLElement): string {
  const view = element.ownerDocument.defaultView;
  return view ? view.getComputedStyle(element).display : element.style.display;
}

function restoreInlineSnapshot(element: HTMLElement, snapshot: InlineSnapshot): void {
  setOrRemove(element, "transform", snapshot.transform);
  setOrRemove(element, "width", snapshot.width);
  setOrRemove(element, "height", snapshot.height);
}

function setOrRemove(element: HTMLElement, property: string, value: string): void {
  if (value) {
    element.style.setProperty(property, value);
  } else {
    element.style.removeProperty(property);
  }
}

function capturePointer(target: Element | null, pointerId: number): void {
  if (!(target instanceof HTMLElement)) {
    return;
  }

  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Pointer capture can fail on synthetic events or detached handles.
  }
}

function releasePointer(target: Element | null, pointerId: number): void {
  if (!(target instanceof HTMLElement)) {
    return;
  }

  try {
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  } catch {
    // Pointer may already be released by the browser.
  }
}

function isGiantTransformTarget(rect: VisualNodeRect, document: Document): boolean {
  const view = document.defaultView;
  if (!view) {
    return false;
  }

  const viewportArea = Math.max(1, view.innerWidth * view.innerHeight);
  const areaRatio = (rect.width * rect.height) / viewportArea;
  const heightRatio = rect.height / Math.max(1, view.innerHeight);
  const nearFullWidth = rect.width >= view.innerWidth * 0.92;
  return areaRatio >= GIANT_TARGET_VIEWPORT_AREA_RATIO ||
    heightRatio >= GIANT_TARGET_VIEWPORT_HEIGHT_RATIO ||
    (nearFullWidth && heightRatio >= 0.85);
}

function describeSignature(target: TransformTarget): { tag: string; classes: string[] } {
  return {
    tag: target.signature.tagName,
    classes: target.signature.classList,
  };
}

function describeElement(element: HTMLElement): { tag: string; classes: string[] } {
  return {
    tag: element.tagName.toLowerCase(),
    classes: Array.from(element.classList),
  };
}

/**
 * Reports a human-readable reason when a layer change might not be visible
 * because the element sits in an isolated stacking context owned by an
 * ancestor (transform/opacity/filter/isolation), so re-stacking relative to
 * siblings outside that context has no effect.
 */
function describeStackingRisk(element: HTMLElement): string {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return "ok";
  }

  let ancestor = element.parentElement;
  while (ancestor && ancestor.tagName.toLowerCase() !== "body") {
    const style = view.getComputedStyle(ancestor);
    if (
      (style.transform && style.transform !== "none") ||
      (style.filter && style.filter !== "none") ||
      style.isolation === "isolate" ||
      (style.opacity !== "" && Number.parseFloat(style.opacity) < 1)
    ) {
      return `ancestor-stacking-context:${ancestor.tagName.toLowerCase()}`;
    }
    ancestor = ancestor.parentElement;
  }

  return "ok";
}
