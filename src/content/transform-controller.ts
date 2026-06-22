import type { PageKey, VisualNodeId } from "../editor/ids.js";
import type { EditorOperation } from "../editor/operations.js";
import type { VisualNodeRect } from "../editor/visual-node.js";
import { matchElementBySignature } from "../editor/dom/signature-matcher.js";
import { readStoredTransformState } from "../editor/dom/element-snapshot.js";
import type { DomRuntimeAdapter } from "../editor/dom/dom-runtime-adapter.js";
import {
  angleForPointer,
  buildMoveOperation,
  buildResizeOperation,
  buildRotateOperation,
  buildZIndexOperation,
  computeNextLayer,
  computeResize,
  isResizeHandleId,
  rectCenterPoint,
  resolveCurrentManagedLayer,
  snapDegrees,
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

const ROTATE_SNAP_DEGREES = 15;

export class TransformController {
  private readonly shell: EditorShell;
  private readonly document: Document;
  private readonly adapter: DomRuntimeAdapter;
  private readonly getPageKey: () => PageKey;
  private readonly onApply: ((operations: EditorOperation[]) => void) | undefined;
  private readonly onDebug: (message: string, data?: unknown) => void;

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
    this.shell.setHandlePointerDownHandler((handleId, event) => {
      this.handleHandlePointerDown(handleId, event);
    });
  }

  setSelection(input: TransformSelectionInput | null): void {
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

  isTransforming(): boolean {
    return this.moveDrag !== null || this.resizeDrag !== null || this.rotateDrag !== null;
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
          });
        }
        return element;
      })
      .filter((element): element is HTMLElement => element !== null)
      .map((element) => {
        const stored = readStoredTransformState(element);
        return {
          element,
          snapshot: captureInlineSnapshot(element),
          baseDx: stored?.dx ?? 0,
          baseDy: stored?.dy ?? 0,
          baseRotate: stored?.rotate ?? 0,
        };
      });

    if (elements.length === 0) {
      this.onDebug("transform-move-no-target", {
        targets: this.selection.targets.map((target) => describeSignature(target)),
      });
      return false;
    }

    this.moveDrag = { startX: x, startY: y, elements };
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
      for (const entry of drag.elements) {
        entry.element.style.transform = composeTransform(
          entry.baseDx + dx,
          entry.baseDy + dy,
          entry.baseRotate,
        );
      }
      this.shell.translateOverlay(dx, dy);
    });
  }

  endMove(x: number, y: number): EditorOperation[] {
    const drag = this.moveDrag;
    this.moveDrag = null;
    if (!drag) {
      return [];
    }

    this.cancelScheduledFrame();
    const dx = x - drag.startX;
    const dy = y - drag.startY;

    for (const entry of drag.elements) {
      restoreInlineSnapshot(entry.element, entry.snapshot);
    }

    if (dx === 0 && dy === 0) {
      this.renderSelection();
      return [];
    }

    const pageKey = this.getPageKey();
    const operations = (this.selection?.targets ?? []).map((target) =>
      buildMoveOperation(target, dx, dy, { pageKey }),
    );

    this.applyOperations(operations);
    this.refreshOutlineFromDom();
    this.onDebug("transform-move-commit", { dx, dy, count: operations.length });
    return operations;
  }

  cancelMove(): void {
    const drag = this.moveDrag;
    this.moveDrag = null;
    if (!drag) {
      return;
    }
    this.cancelScheduledFrame();
    for (const entry of drag.elements) {
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
    for (const target of targets) {
      const element = this.resolveElement(target);
      if (!element) {
        this.onDebug("transform-layer-skip", {
          reason: "target-not-resolved",
          selected: describeSignature(target),
        });
        continue;
      }

      const currentLayer = resolveCurrentManagedLayer(
        element.style.zIndex,
        readComputedZIndex(element),
      );
      const nextLayer = computeNextLayer(currentLayer, command);
      this.onDebug("transform-target", {
        phase: "layer",
        command,
        selected: describeSignature(target),
        target: describeElement(element),
        currentLayer,
        nextLayer,
        reason: describeStackingRisk(element),
      });
      operations.push(
        buildZIndexOperation(target, nextLayer, currentLayer, { pageKey }),
      );
    }

    if (operations.length === 0) {
      return [];
    }

    this.applyOperations(operations);
    this.refreshOutlineFromDom();
    this.onDebug("transform-layer", { command, count: operations.length });
    return operations;
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
    } else if (isResizeHandleId(handleId)) {
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

    this.applyOperations(operations);
    this.refreshOutlineFromDom();
    this.onDebug("transform-resize-commit", {
      width: result.width,
      height: result.height,
    });
    return operations;
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
    }
    if (this.rotateDrag) {
      restoreInlineSnapshot(this.rotateDrag.element, this.rotateDrag.snapshot);
      this.rotateDrag = null;
    }
    this.detachHandleWindowListeners();
    this.cancelScheduledFrame();
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
      }
    };
    const onUp = (event: PointerEvent): void => {
      if (this.resizeDrag) {
        this.endResize(event.clientX, event.clientY);
      } else if (this.rotateDrag) {
        this.endRotate(event.clientX, event.clientY);
      }
      this.detachHandleWindowListeners();
    };

    const moveListener = onMove as EventListener;
    const upListener = onUp as EventListener;
    view.addEventListener("pointermove", moveListener, true);
    view.addEventListener("pointerup", upListener, true);
    view.addEventListener("pointercancel", upListener, true);

    this.handleWindowListeners = () => {
      view.removeEventListener("pointermove", moveListener, true);
      view.removeEventListener("pointerup", upListener, true);
      view.removeEventListener("pointercancel", upListener, true);
    };
  }

  private detachHandleWindowListeners(): void {
    this.handleWindowListeners?.();
    this.handleWindowListeners = null;
  }

  private applyOperations(operations: EditorOperation[]): void {
    for (const operation of operations) {
      const nodeId = operation.target.nodeId;
      const override = nodeId ? this.elementRegistry.get(nodeId) ?? null : null;
      const result = this.adapter.applyOperation(
        operation,
        override?.isConnected ? override : null,
      );
      if (!result.ok) {
        this.onDebug("transform-apply-failed", { code: result.code, error: result.error });
      }
    }
    if (operations.length > 0) {
      this.onApply?.(operations);
    }
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
    this.shell.renderSelectionOutlines(this.selection.outlineRects, this.selection.variant, {
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
        memberRects.push(rect);
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
        this.selection.handleTarget.rect = currentRect(element);
      }
    }

    this.renderSelection();
  }

  private scheduleFrame(task: () => void): void {
    const view = this.document.defaultView;
    if (!view || typeof view.requestAnimationFrame !== "function") {
      task();
      return;
    }

    this.pendingTask = task;
    if (this.rafId !== null) {
      return;
    }

    this.rafId = view.requestAnimationFrame(() => {
      this.rafId = null;
      const pending = this.pendingTask;
      this.pendingTask = null;
      pending?.();
    });
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

function currentRect(element: HTMLElement): VisualNodeRect {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function captureInlineSnapshot(element: HTMLElement): InlineSnapshot {
  return {
    transform: element.style.transform,
    width: element.style.width,
    height: element.style.height,
  };
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

function readComputedZIndex(element: HTMLElement): string {
  const view = element.ownerDocument.defaultView;
  return view ? view.getComputedStyle(element).zIndex : "";
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
