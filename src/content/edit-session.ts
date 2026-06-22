import {
  beginPointerGesture,
  getEventComposedPath,
  isLassoGesture,
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
import type { EditorSelection } from "../editor/editor-selection.js";
import type { SelectionResolveResult } from "../editor/selection/selection-resolver.js";
import type { LayerCommand, TransformTarget } from "../editor/transform/index.js";
import { createDomRuntimeAdapter, type DomRuntimeAdapter } from "../editor/dom/dom-runtime-adapter.js";
import { attachEditModePointerPipeline } from "./edit-mode-pointer-pipeline.js";
import type { EditModePointerPipeline } from "./edit-mode-pointer-pipeline.js";
import type { EditorShell } from "./editor-shell.js";
import {
  createTransformController,
  type TransformController,
  type TransformSelectionInput,
} from "./transform-controller.js";

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
  private transformController: TransformController | null = null;
  private adapter: DomRuntimeAdapter | null = null;
  private pointerPipeline: EditModePointerPipeline | null = null;
  private activeGesture: PointerGestureState | null = null;
  private captureTarget: HTMLElement | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private movePending = false;
  private moveActive = false;

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

    this.adapter = createDomRuntimeAdapter(this.root);
    this.transformController = createTransformController({
      shell: this.shell,
      document: this.root,
      adapter: this.adapter,
      getPageKey: () => this.computePageKey(),
      onDebug: this.onDebug,
    });

    this.selectionController = createSelectionController({
      getGraph: () => {
        if (!this.cacheController) {
          throw new Error("EditSession is not started");
        }
        return this.cacheController.cache.ensureFresh();
      },
      getDocument: () => this.root,
      onSelectionChange: (selection, result) => {
        this.handleSelectionChange(selection, result);
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

    this.attachKeyHandler(windowRef);
    this.cacheController.cache.ensureFresh();
  }

  stop(): void {
    this.pointerPipeline?.detach();
    this.pointerPipeline = null;
    this.detachKeyHandler();
    this.transformController?.dispose();
    this.transformController = null;
    this.adapter = null;
    this.cacheController?.dispose();
    this.cacheController = null;
    this.selectionController = null;
    this.shell.clearOverlays();
    this.activeGesture = null;
    this.captureTarget = null;
    this.movePending = false;
    this.moveActive = false;
  }

  private handleSelectionChange(
    _selection: EditorSelection,
    result: SelectionResolveResult,
  ): void {
    if (!this.transformController) {
      return;
    }

    const input = toTransformSelectionInput(result);
    this.transformController.setSelection(input);
  }

  private computePageKey(): string {
    const location = this.root.defaultView?.location;
    if (location) {
      return `${location.origin}${location.pathname}`;
    }
    return "otf://unknown";
  }

  groupSelection(): void {
    const result = this.selectionController?.groupSelection();
    if (result) {
      this.onDebug("group", {
        grouped: result.group !== undefined,
        memberCount: result.group?.memberIds.length ?? 0,
        rejectionReason: result.rejectionReason,
      });
    }
  }

  ungroupSelection(): void {
    const result = this.selectionController?.ungroupSelection();
    if (result) {
      this.onDebug("ungroup", {
        memberCount: result.resolvedNodes.length,
        rejectionReason: result.rejectionReason,
      });
    }
  }

  private attachKeyHandler(windowRef: Window): void {
    if (this.keyHandler) {
      return;
    }

    this.keyHandler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "g") {
        if (!this.selectionController?.getSelection()) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          this.ungroupSelection();
        } else {
          this.groupSelection();
        }
        return;
      }

      // Layer shortcuts must key off `event.code` (physical key), not
      // `event.key`: with Shift held the browser reports "}"/"{" for the
      // bracket keys, so the Ctrl+Shift+] / Ctrl+Shift+[ variants would never
      // match. The code stays "BracketRight"/"BracketLeft" regardless of Shift.
      if (event.code === "BracketRight" || event.code === "BracketLeft") {
        if (!this.transformController?.hasSelection()) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.transformController.applyLayerCommand(
          resolveLayerCommand(event.code, event.shiftKey),
        );
      }
    };

    windowRef.addEventListener("keydown", this.keyHandler, true);
  }

  private detachKeyHandler(): void {
    if (!this.keyHandler) {
      return;
    }

    const windowRef = this.root.defaultView;
    windowRef?.removeEventListener("keydown", this.keyHandler, true);
    this.keyHandler = null;
  }

  handleEscape(): boolean {
    if (this.transformController?.isTransforming()) {
      this.transformController.cancelMove();
      this.movePending = false;
      this.moveActive = false;
      return true;
    }

    const selection = this.selectionController?.getSelection();
    if (selection && selection.selectedNodeIds.length > 0) {
      this.selectionController?.clearSelection();
      this.transformController?.clearSelection();
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
    this.movePending =
      !event.shiftKey &&
      (this.transformController?.hasSelection() ?? false) &&
      (this.transformController?.hitTestSelection(event.clientX, event.clientY) ?? false);
    this.moveActive = false;
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

    if (this.movePending && this.transformController) {
      if (
        !this.moveActive &&
        isLassoGesture(
          this.activeGesture.startX,
          this.activeGesture.startY,
          event.clientX,
          event.clientY,
        )
      ) {
        this.moveActive = this.transformController.beginMove(
          this.activeGesture.startX,
          this.activeGesture.startY,
        );
      }

      if (this.moveActive) {
        this.transformController.updateMove(event.clientX, event.clientY);
        return;
      }
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
    const wasMoveActive = this.moveActive;
    this.movePending = false;
    this.moveActive = false;

    if (wasMoveActive && this.transformController) {
      this.activeGesture = null;
      this.releasePointerCapture(gesture.pointerId);
      this.transformController.endMove(event.clientX, event.clientY);
      return;
    }

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

    if (this.moveActive) {
      this.transformController?.cancelMove();
    }
    this.movePending = false;
    this.moveActive = false;
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

function resolveLayerCommand(code: string, shiftKey: boolean): LayerCommand {
  if (code === "BracketRight") {
    return shiftKey ? "front" : "forward";
  }
  return shiftKey ? "back" : "backward";
}

function toTransformSelectionInput(
  result: SelectionResolveResult,
): TransformSelectionInput | null {
  if (result.group) {
    const targets: TransformTarget[] = result.group.members.map((member) => ({
      nodeId: member.nodeId,
      signature: member.signature,
      rect: { ...member.rect },
      ...(member.element ? { element: member.element } : {}),
    }));
    if (targets.length === 0) {
      return null;
    }
    return {
      targets,
      outlineRects: [result.group.unionRect],
      variant: "group",
      handleTarget: null,
    };
  }

  if (result.resolvedNodes.length === 0) {
    return null;
  }

  const targets: TransformTarget[] = result.resolvedNodes.map((node) => ({
    nodeId: node.id,
    signature: node.signature,
    rect: { ...node.rect },
    ...(node.element ? { element: node.element } : {}),
  }));

  return {
    targets,
    outlineRects: targets.map((target) => ({ ...target.rect })),
    variant: "node",
    handleTarget: targets.length === 1 ? (targets[0] ?? null) : null,
  };
}
