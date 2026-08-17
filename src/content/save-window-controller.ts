import type { DomRuntimeAdapter } from "../editor/dom/dom-runtime-adapter.js";
import type { MeasurementRect } from "../editor/measurement/types.js";
import {
  beginPointerGesture,
  isLassoGesture,
  normalizeLassoRect,
  type PointerGestureState,
} from "../editor/selection/pointer-interaction.js";
import {
  classifyOperationsForSaveWindow,
  selectOperationsToKeep,
  selectOperationsToRevert,
  type SaveWindowClassification,
} from "../editor/save-window/classify-operations.js";
import {
  SAVE_WINDOW_DRAG_THRESHOLD_PX,
  SAVE_WINDOW_MIN_RECT_PX,
} from "../editor/save-window/constants.js";
import type { EditorShell } from "./editor-shell.js";
import { SaveWindowPanel } from "./save-window-panel.js";
import { pruneSessionHistory, type SessionHistory } from "./session-history.js";
import {
  promoteDraftOperationsToSaved,
  type SessionOperationState,
} from "./session-operation-state.js";
import type { SavePageOperationsResult } from "./storage-client.js";

export type SaveWindowPhase = "idle" | "drawing" | "confirming";

export interface SaveWindowControllerOptions {
  shell: EditorShell;
  root: Document;
  adapter: DomRuntimeAdapter;
  getOperationState: () => SessionOperationState;
  setOperationState: (state: SessionOperationState) => void;
  syncSavedOperationsToStorage: () => Promise<SavePageOperationsResult>;
  getSessionHistory: () => SessionHistory;
  setSessionHistory: (history: SessionHistory) => void;
  onDebug?: (message: string, data?: unknown) => void;
}

export class SaveWindowController {
  private readonly shell: EditorShell;
  private readonly root: Document;
  private readonly adapter: DomRuntimeAdapter;
  private readonly getOperationState: () => SessionOperationState;
  private readonly setOperationState: (state: SessionOperationState) => void;
  private readonly syncSavedOperationsToStorage: () => Promise<SavePageOperationsResult>;
  private readonly getSessionHistory: () => SessionHistory;
  private readonly setSessionHistory: (history: SessionHistory) => void;
  private readonly onDebug: (message: string, data?: unknown) => void;
  private readonly panel: SaveWindowPanel | null;
  private phase: SaveWindowPhase = "idle";
  private gesture: PointerGestureState | null = null;
  private captureTarget: HTMLElement | null = null;
  private pendingRect: MeasurementRect | null = null;
  private windowRect: MeasurementRect | null = null;
  private classification: SaveWindowClassification | null = null;
  private frameId: number | null = null;

  constructor(options: SaveWindowControllerOptions) {
    this.shell = options.shell;
    this.root = options.root;
    this.adapter = options.adapter;
    this.getOperationState = options.getOperationState;
    this.setOperationState = options.setOperationState;
    this.syncSavedOperationsToStorage = options.syncSavedOperationsToStorage;
    this.getSessionHistory = options.getSessionHistory;
    this.setSessionHistory = options.setSessionHistory;
    this.onDebug = options.onDebug ?? (() => undefined);

    const shadowRoot = options.shell.getShadowRoot();
    this.panel =
      shadowRoot === null
        ? null
        : new SaveWindowPanel(shadowRoot, {
            onConfirm: () => {
              void this.confirm();
            },
            onCancel: () => {
              this.cancel();
            },
          });
  }

  getPhase(): SaveWindowPhase {
    return this.phase;
  }

  isActive(): boolean {
    return this.phase !== "idle";
  }

  start(): boolean {
    if (this.phase !== "idle") {
      return false;
    }

    if (this.getOperationState().draftOperations.length === 0) {
      this.onDebug("save-window-start-skipped", { reason: "no_draft_operations" });
      return false;
    }

    this.phase = "drawing";
    this.shell.renderSaveWindowBox(null);
    this.onDebug("save-window-start", {});
    return true;
  }

  cancel(): void {
    if (this.phase === "idle") {
      return;
    }

    this.releaseGesture();
    this.panel?.hide();
    this.shell.renderSaveWindowBox(null);
    this.phase = "idle";
    this.windowRect = null;
    this.classification = null;
    this.onDebug("save-window-cancel", {});
  }

  async confirm(): Promise<boolean> {
    if (this.phase !== "confirming" || !this.classification || !this.windowRect) {
      return false;
    }

    const toKeep = selectOperationsToKeep(this.classification);
    const toRevert = selectOperationsToRevert(this.classification);
    const revertIds = new Set(toRevert.map((operation) => operation.id));

    const revertSnapshot = this.adapter.buildBatchSnapshot(toRevert);
    this.adapter.restoreBatchSnapshot(revertSnapshot, "before");
    this.adapter.removeEffectsByOperationIds(revertIds);

    const nextState = promoteDraftOperationsToSaved(this.getOperationState(), toKeep);
    const previousState = this.getOperationState();
    this.setOperationState({
      ...nextState,
      draftOperations: [],
    });
    const persist = await this.syncSavedOperationsToStorage();
    if (!persist.ok) {
      this.adapter.restoreBatchSnapshot(revertSnapshot, "after");
      this.setOperationState(previousState);
      this.onDebug("save-window-persist-failed", { error: persist.error });
      return false;
    }
    if (persist.capReached) {
      this.onDebug("save-cap-reached", {
        trimmed: persist.trimmed ?? 0,
        capReached: true,
        source: "save-window",
      });
    }

    const prunedHistory = pruneSessionHistory(this.getSessionHistory(), revertIds);
    this.setSessionHistory(prunedHistory);

    this.onDebug("save-window-confirm", {
      windowRect: this.windowRect,
      kept: toKeep.length,
      reverted: toRevert.length,
      ambiguous: this.classification.ambiguous.length,
      reasons: {
        kept: this.classification.kept.map((entry) => ({
          id: entry.operation.id,
          reason: entry.reason,
        })),
        reverted: this.classification.reverted.map((entry) => ({
          id: entry.operation.id,
          reason: entry.reason,
        })),
        ambiguous: this.classification.ambiguous.map((entry) => ({
          id: entry.operation.id,
          reason: entry.reason,
        })),
      },
    });

    this.releaseGesture();
    this.panel?.hide();
    this.shell.renderSaveWindowBox(null);
    this.phase = "idle";
    this.windowRect = null;
    this.classification = null;
    return true;
  }

  handlePointerDown(event: PointerEvent): boolean {
    if (this.phase !== "drawing" || event.button !== 0) {
      return this.phase === "confirming";
    }

    if (this.gesture) {
      return true;
    }

    this.gesture = beginPointerGesture(
      event.pointerId,
      event.clientX,
      event.clientY,
      false,
      false,
    );
    this.captureTarget = event.target instanceof HTMLElement ? event.target : this.root.documentElement;
    try {
      this.captureTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore capture failures in tests
    }
    return true;
  }

  handlePointerMove(event: PointerEvent): boolean {
    if (this.phase !== "drawing" || !this.gesture || event.pointerId !== this.gesture.pointerId) {
      return this.phase !== "idle";
    }

    if (
      !isLassoGesture(
        this.gesture.startX,
        this.gesture.startY,
        event.clientX,
        event.clientY,
        SAVE_WINDOW_DRAG_THRESHOLD_PX,
      )
    ) {
      return true;
    }

    this.pendingRect = normalizeLassoRect(
      this.gesture.startX,
      this.gesture.startY,
      event.clientX,
      event.clientY,
    );
    this.scheduleRender();
    return true;
  }

  handlePointerUp(event: PointerEvent): boolean {
    if (this.phase === "confirming") {
      return true;
    }

    if (this.phase !== "drawing" || !this.gesture || event.pointerId !== this.gesture.pointerId) {
      return false;
    }

    const gesture = this.gesture;
    this.pendingRect = normalizeLassoRect(
      gesture.startX,
      gesture.startY,
      event.clientX,
      event.clientY,
    );
    this.releaseGesture();

    const rect = this.pendingRect;
    this.pendingRect = null;
    this.cancelPendingFrame();

    if (
      rect.width < SAVE_WINDOW_MIN_RECT_PX ||
      rect.height < SAVE_WINDOW_MIN_RECT_PX ||
      !isLassoGesture(gesture.startX, gesture.startY, event.clientX, event.clientY, SAVE_WINDOW_DRAG_THRESHOLD_PX)
    ) {
      this.shell.renderSaveWindowBox(null);
      this.phase = "idle";
      this.onDebug("save-window-draw-cancelled", { reason: "rect_too_small" });
      return true;
    }

    this.windowRect = rect;
    this.shell.renderSaveWindowBox(rect);
    this.classification = classifyOperationsForSaveWindow({
      root: this.root,
      operations: this.getOperationState().draftOperations,
      windowRect: rect,
    });
    this.phase = "confirming";
    this.panel?.show(
      {
        ...this.classification.summary,
        ambiguousDefault: "revert",
      },
      rect,
    );
    this.onDebug("save-window-classification", {
      windowRect: rect,
      summary: this.classification.summary,
    });
    return true;
  }

  handlePointerCancel(event: PointerEvent): boolean {
    if (this.phase === "idle") {
      return false;
    }

    if (this.gesture && event.pointerId === this.gesture.pointerId) {
      this.releaseGesture();
      if (this.phase === "drawing") {
        this.shell.renderSaveWindowBox(null);
        this.phase = "idle";
      }
    }
    return true;
  }

  private scheduleRender(): void {
    const view = this.root.defaultView;
    if (!view || typeof view.requestAnimationFrame !== "function") {
      if (this.pendingRect) {
        this.shell.renderSaveWindowBox(this.pendingRect);
      }
      return;
    }

    if (this.frameId !== null) {
      return;
    }

    if (this.pendingRect) {
      this.shell.renderSaveWindowBox(this.pendingRect);
    }

    this.frameId = view.requestAnimationFrame(() => {
      this.frameId = null;
      if (this.pendingRect) {
        this.shell.renderSaveWindowBox(this.pendingRect);
      }
    });
  }

  private cancelPendingFrame(): void {
    const view = this.root.defaultView;
    if (this.frameId !== null && view && typeof view.cancelAnimationFrame === "function") {
      view.cancelAnimationFrame(this.frameId);
    }
    this.frameId = null;
  }

  private releaseGesture(): void {
    if (this.gesture && this.captureTarget) {
      try {
        this.captureTarget.releasePointerCapture(this.gesture.pointerId);
      } catch {
        // ignore
      }
    }
    this.gesture = null;
    this.captureTarget = null;
    this.cancelPendingFrame();
  }
}
