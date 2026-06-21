import {
  beginPointerGesture,
  getEventComposedPath,
  normalizeLassoRect,
  resolvePointerGestureAction,
  updatePointerGesture,
  type PointerGestureState,
} from "../editor/selection/pointer-interaction.js";
import { logSelectionDebug } from "../editor/selection/selection-debug.js";
import {
  createGeometryCacheController,
} from "../editor/visual-graph/dom-invalidation-listener.js";
import {
  createSelectionController,
  type SelectionController,
} from "../editor/selection/selection-controller.js";
import { attachEditModePointerPipeline } from "./edit-mode-pointer-pipeline.js";
import type { EditModePointerPipeline } from "./edit-mode-pointer-pipeline.js";
import type { EditorShell } from "./editor-shell.js";

export interface EditSessionOptions {
  shell: EditorShell;
  root: Document;
  onDebug?: (message: string, data?: unknown) => void;
}

export class EditSession {
  private readonly shell: EditorShell;
  private readonly root: Document;
  private readonly onDebug: (message: string, data?: unknown) => void;
  private cacheController: ReturnType<typeof createGeometryCacheController> | null = null;
  private selectionController: SelectionController | null = null;
  private pointerPipeline: EditModePointerPipeline | null = null;
  private activeGesture: PointerGestureState | null = null;
  private captureTarget: HTMLElement | null = null;

  constructor(options: EditSessionOptions) {
    this.shell = options.shell;
    this.root = options.root;
    this.onDebug = options.onDebug ?? logSelectionDebug;
  }

  start(): void {
    if (this.cacheController) {
      return;
    }

    this.cacheController = createGeometryCacheController({
      cacheOptions: { root: this.root },
      listeners: {
        window: this.root.defaultView as Window,
        root: this.root,
      },
    });

    this.selectionController = createSelectionController({
      getGraph: () => {
        if (!this.cacheController) {
          throw new Error("EditSession is not started");
        }
        return this.cacheController.cache.ensureFresh();
      },
      getDocument: () => this.root,
      onSelectionChange: (_selection, result) => {
        this.shell.renderSelectionOutlines(result.resolvedNodes.map((node) => node.rect));
        this.shell.renderLassoBox(null);
      },
    });

    const windowRef = this.root.defaultView;
    if (!windowRef) {
      return;
    }

    this.pointerPipeline = attachEditModePointerPipeline({
      window: windowRef,
      document: this.root,
      onPointerDown: (event) => {
        this.handlePointerDown(event);
      },
      onPointerMove: (event) => {
        this.handlePointerMove(event);
      },
      onPointerUp: (event) => {
        this.handlePointerUp(event);
      },
      onPointerCancel: (event) => {
        this.handlePointerCancel(event);
      },
      onDebug: this.onDebug,
    });

    this.cacheController.cache.ensureFresh();
  }

  stop(): void {
    this.pointerPipeline?.detach();
    this.pointerPipeline = null;
    this.cacheController?.dispose();
    this.cacheController = null;
    this.selectionController = null;
    this.shell.clearOverlays();
    this.activeGesture = null;
    this.captureTarget = null;
  }

  handleEscape(): boolean {
    const selection = this.selectionController?.getSelection();
    if (selection && selection.selectedNodeIds.length > 0) {
      this.selectionController?.clearSelection();
      this.shell.clearOverlays();
      return true;
    }

    return false;
  }

  private handlePointerDown(event: PointerEvent): void {
    if (this.activeGesture) {
      return;
    }

    this.activeGesture = beginPointerGesture(
      event.pointerId,
      event.clientX,
      event.clientY,
      event.shiftKey,
    );
    this.captureTarget = this.resolveCaptureTarget(event);

    try {
      this.captureTarget.setPointerCapture(event.pointerId);
    } catch {
      this.onDebug("pointer-capture-failed", { pointerId: event.pointerId });
    }
  }

  private resolveCaptureTarget(event: PointerEvent): HTMLElement {
    if (event.target instanceof HTMLElement) {
      return event.target;
    }

    return this.root.documentElement;
  }

  private handlePointerMove(event: PointerEvent): void {
    if (!this.activeGesture || event.pointerId !== this.activeGesture.pointerId) {
      return;
    }

    const previousKind = this.activeGesture.kind;
    this.activeGesture = updatePointerGesture(
      this.activeGesture,
      event.clientX,
      event.clientY,
    );

    if (previousKind === "pending" && this.activeGesture.kind === "lasso") {
      this.onDebug("rectangle-start", {
        x: this.activeGesture.startX,
        y: this.activeGesture.startY,
      });
    }

    if (this.activeGesture.kind === "lasso") {
      this.shell.renderLassoBox(
        normalizeLassoRect(
          this.activeGesture.startX,
          this.activeGesture.startY,
          event.clientX,
          event.clientY,
        ),
      );
    }
  }

  private handlePointerUp(event: PointerEvent): void {
    if (!this.activeGesture || event.pointerId !== this.activeGesture.pointerId) {
      return;
    }

    const gesture = this.activeGesture;
    const action = resolvePointerGestureAction(
      gesture,
      event.clientX,
      event.clientY,
    );
    this.activeGesture = null;
    this.releasePointerCapture(gesture.pointerId);

    if (!this.selectionController || !this.cacheController) {
      this.shell.renderLassoBox(null);
      return;
    }

    this.cacheController.cache.ensureFresh();
    const composedPath = getEventComposedPath(event);

    if (action === "lasso") {
      const result = this.selectionController.handleLasso(
        gesture.startX,
        gesture.startY,
        event.clientX,
        event.clientY,
        gesture.shiftKey,
      );
      this.onDebug("rectangle-resolve", {
        rect: normalizeLassoRect(gesture.startX, gesture.startY, event.clientX, event.clientY),
        samplePointCount: result.rectangleStats?.samplePointCount ?? 0,
        collectedElementCount: result.rectangleStats?.collectedElementCount ?? 0,
        candidateCount: result.rectangleStats?.candidateCount ?? 0,
        selectedCount: result.resolvedNodes.length,
        selected: result.rectangleStats?.selected ?? [],
        rejectionReason: result.rejectionReason,
        rejectedWholePage: result.rejectedWholePage,
      });
      return;
    }

    const result = this.selectionController.handlePointerClick(
      event.clientX,
      event.clientY,
      gesture.shiftKey,
      composedPath,
    );
    this.onDebug("click-resolve", {
      count: result.resolvedNodes.length,
      source: result.selection.source,
      rejectionReason: result.rejectionReason,
    });
    this.shell.renderLassoBox(null);
  }

  private handlePointerCancel(event: PointerEvent): void {
    if (!this.activeGesture || event.pointerId !== this.activeGesture.pointerId) {
      return;
    }

    this.activeGesture = null;
    this.releasePointerCapture(event.pointerId);
    this.shell.renderLassoBox(null);
  }

  private releasePointerCapture(pointerId: number): void {
    if (!this.captureTarget) {
      return;
    }

    try {
      if (this.captureTarget.hasPointerCapture(pointerId)) {
        this.captureTarget.releasePointerCapture(pointerId);
      }
    } catch {
      // Pointer may already be released.
    }

    this.captureTarget = null;
  }
}

export function createEditSession(options: EditSessionOptions): EditSession {
  return new EditSession(options);
}
