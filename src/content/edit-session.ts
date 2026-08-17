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
  createPerformanceInstrumentation,
  type PerformanceInstrumentation,
} from "../editor/performance/performance-instrumentation.js";
import {
  createGeometryCacheController,
} from "../editor/visual-graph/dom-invalidation-listener.js";
import {
  createSelectionController,
  type SelectionController,
} from "../editor/selection/selection-controller.js";
import {
  buildGroupOperation,
  buildUngroupOperation,
  findLatestPersistedGroupState,
} from "../editor/selection/group-operation-state.js";
import type { EditorSelection } from "../editor/editor-selection.js";
import type { SelectionResolveResult } from "../editor/selection/selection-resolver.js";
import type { LayerCommand, TransformTarget } from "../editor/transform/index.js";
import type { EditorOperation, StyleProperty } from "../editor/operations.js";
import type { CommandContext } from "../editor/editor-command.js";
import {
  CommandRegistry,
  createCommandRegistry,
  findCommandForKeyboardEvent,
} from "../editor/commands/command-registry.js";
import type { DomRuntimeAdapter } from "../editor/dom/dom-runtime-adapter.js";
import { matchElementBySignature } from "../editor/dom/signature-matcher.js";
import type { VisualNodeRect, VisualNode } from "../editor/visual-node.js";
import type { VisualNodeId } from "../editor/ids.js";
import {
  captureEditorClipboard,
  createDuplicateOperations,
  resolveDuplicateElement,
  type EditorClipboardEntry,
} from "../editor/duplicate/duplicate-element.js";
import { createOperationId } from "../editor/transform/operation-id.js";
import { attachEditModePointerPipeline } from "./edit-mode-pointer-pipeline.js";
import type { EditModePointerPipeline } from "./edit-mode-pointer-pipeline.js";
import type { EditorShell } from "./editor-shell.js";
import {
  createTransformController,
  type TransformController,
  type TransformSelectionInput,
} from "./transform-controller.js";
import { createDefaultCommands, TOOLBAR_COMMAND_IDS } from "./default-commands.js";
import type { SessionCommandHost } from "./session-command-host.js";
import {
  canRedo,
  canUndo,
  createSessionHistory,
  popRedoBatch,
  popUndoBatch,
  recordHistoryBatch,
  type SessionHistory,
} from "./session-history.js";
import {
  appendDraftOperations,
  clearAllOperations,
  createSessionOperationState,
  getAppliedOperations,
  hasUnsavedChanges,
  promoteAllDraftToSaved,
  removeDraftOperationsById,
  unsavedChangeCount,
  type SessionOperationState,
} from "./session-operation-state.js";
import { createStyleTextController, StyleTextController } from "./style-text-controller.js";
import { FloatingToolbar } from "./floating-toolbar.js";
import { PageCustomizationController } from "./page-customization-controller.js";
import { isInsideEphemeralSurface } from "./ephemeral-surface.js";
import {
  extractEditableText,
  resolveTextEditTargetAtPoint,
  resolveTextEditTargetForSelection,
} from "../editor/style/text-target-resolver.js";
import { SaveWindowController } from "./save-window-controller.js";
import { createEmptyBatchSnapshot } from "../editor/dom/operation-batch-snapshot.js";
import { logZIndexBatchDiagnostics } from "../editor/diagnostics/editor-diagnostics.js";
import type { ZIndexOperation } from "../editor/operations.js";
import { isLocalAgentAvailable } from "../shared/build-flags.js";
import { AgentPreviewController } from "./agent/agent-preview-controller.js";
import { AgentPanel } from "./agent/agent-panel.js";
import type { AgentContextInput } from "./agent/context-builder.js";

export interface EditSessionOptions {
  shell: EditorShell;
  root: Document;
  pageCustomization: PageCustomizationController;
  onDebug?: (message: string, data?: unknown) => void;
}

const DOUBLE_CLICK_MS = 400;

interface InPlaceTextEditState {
  element: HTMLElement;
  target: TransformTarget;
  originalText: string;
  previousContentEditable: string | null;
  previousUserSelect: string;
  multiline: boolean;
  finished: boolean;
  keyHandler: (event: KeyboardEvent) => void;
  blurHandler: () => void;
}

export class EditSession implements SessionCommandHost {
  private readonly shell: EditorShell;
  private readonly root: Document;
  private readonly pageCustomization: PageCustomizationController;
  private readonly onDebug: (message: string, data?: unknown) => void;
  private cacheController: ReturnType<typeof createGeometryCacheController> | null = null;
  private selectionController: SelectionController | null = null;
  private transformController: TransformController | null = null;
  private styleTextController: StyleTextController | null = null;
  private adapter: DomRuntimeAdapter | null = null;
  private pointerPipeline: EditModePointerPipeline | null = null;
  private commandRegistry: CommandRegistry | null = null;
  private toolbar: FloatingToolbar | null = null;
  private sessionHistory: SessionHistory = createSessionHistory();
  private operationState: SessionOperationState = createSessionOperationState();
  private activeGesture: PointerGestureState | null = null;
  private captureTarget: HTMLElement | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private movePending = false;
  private moveActive = false;
  private lastSelectionResult: SelectionResolveResult | null = null;
  private lastClickTime = 0;
  private lastClickNodeId: string | null = null;
  private lastClickX = 0;
  private lastClickY = 0;
  private clickSelectionSnapshot: {
    selection: EditorSelection;
    resolvedNodes: VisualNode[];
  } | null = null;
  private firstClickSelectionSnapshot: {
    selection: EditorSelection;
    resolvedNodes: VisualNode[];
  } | null = null;
  private lastGroupedSelectionSnapshot: {
    selection: EditorSelection;
    resolvedNodes: VisualNode[];
  } | null = null;
  private agentSelectionOverride: EditorSelection | null = null;
  private agentSelectedNodesOverride: VisualNode[] | null = null;
  private lastSelectionKey: string | null = null;
  private textEditTarget: TransformTarget | null = null;
  private inPlaceTextEdit: InPlaceTextEditState | null = null;
  private toolbarOpen = false;
  private interactMode = false;
  private perf: PerformanceInstrumentation = createPerformanceInstrumentation();
  private lassoFrameId: number | null = null;
  private pendingLassoRect: ReturnType<typeof normalizeLassoRect> | null = null;
  private editorClipboard: EditorClipboardEntry[] | null = null;
  private saveWindowController: SaveWindowController | null = null;
  private agentPreviewController: AgentPreviewController | null = null;
  private agentPanel: AgentPanel | null = null;
  private lastPersistedGroupId: string | null = null;
  private beforeUnloadHandler: ((event: BeforeUnloadEvent) => void) | null = null;

  constructor(options: EditSessionOptions) {
    this.shell = options.shell;
    this.root = options.root;
    this.pageCustomization = options.pageCustomization;
    this.onDebug = options.onDebug ?? logSelectionDebug;
  }

  async start(): Promise<void> {
    if (this.cacheController) {
      return;
    }

    this.cacheController = createGeometryCacheController({
      cacheOptions: {
        root: this.root,
        onRebuild: ({ durationMs, reason, nodeCount }) => {
          this.perf.record("geometry-rebuild", durationMs, { reason, nodeCount });
        },
      },
      schedulerOptions: {
        throttleMs: 120,
        debounceMs: 200,
      },
      listeners: {
        window: this.root.defaultView as Window,
        root: this.root,
      },
    });

    const replay = await this.pageCustomization.ensureReplayed(this.onDebug);
    if (replay.failed > 0 || replay.unresolved > 0) {
      this.onDebug("page-replay-incomplete", replay);
    }
    this.attachPageIdentityHooks();
    this.attachBeforeUnloadGuard();
    this.adapter = this.pageCustomization.getAdapter();
    this.operationState = createSessionOperationState([
      ...this.pageCustomization.getPageOperations(),
    ]);

    this.shell.setSaveButton({
      visible: false,
      count: 0,
      onSave: () => {
        void this.saveAll();
      },
    });

    this.saveWindowController = new SaveWindowController({
      shell: this.shell,
      root: this.root,
      adapter: this.adapter,
      getOperationState: () => this.operationState,
      setOperationState: (state) => {
        this.operationState = state;
        this.syncPageCustomizationOperations();
        this.updateSaveButton();
      },
      syncSavedOperationsToStorage: () => this.pageCustomization.syncOperationsToStorage(),
      getSessionHistory: () => this.sessionHistory,
      setSessionHistory: (history) => {
        this.sessionHistory = history;
        this.updateSaveButton();
      },
      onDebug: this.onDebug,
    });

    this.transformController = createTransformController({
      shell: this.shell,
      document: this.root,
      adapter: this.adapter,
      getPageKey: () => this.computePageKey(),
      onApply: (operations) => {
        this.recordOperations(operations);
      },
      onDebug: this.onDebug,
      onInteractionStart: () => {
        this.cacheController?.scheduler.suspend();
      },
      onInteractionEnd: () => {
        this.cacheController?.scheduler.resume();
      },
      onGeometryChanged: () => {
        this.cacheController?.cache.invalidate("edit");
        this.cacheController?.scheduler.request("edit");
      },
      onFrame: (durationMs) => {
        this.perf.record("transform-frame", durationMs);
      },
    });

    this.styleTextController = createStyleTextController({
      document: this.root,
      adapter: this.adapter,
      getPageKey: () => this.computePageKey(),
      resolveTargets: () => this.transformController?.getTargets() ?? [],
      resolveTextTarget: () => this.textEditTarget ?? this.transformController?.getHandleTarget() ?? null,
      onApply: (operations) => {
        this.recordOperations(operations);
      },
      onDebug: this.onDebug,
    });

    this.commandRegistry = createCommandRegistry(createDefaultCommands(this));

    const shadowRoot = this.shell.getShadowRoot();
    if (shadowRoot) {
      this.toolbar = new FloatingToolbar({
        shadowRoot,
        callbacks: {
          onCommand: (commandId) => {
            void this.executeCommand(commandId);
          },
          onStyleChange: (property, value) => {
            this.previewStyle(property, value);
          },
          onStylePanelApply: () => {
            this.applyStylePreview();
          },
          onStylePanelReset: () => {
            this.cancelStylePreview();
            return this.readStylePanelValues();
          },
          onTextCommit: (value) => {
            this.applyText(value);
            this.textEditTarget = null;
          },
          onTextCancel: () => {
            this.textEditTarget = null;
          },
          onStylePanelClose: () => {
            this.cancelStylePreview();
            this.updateToolbar();
          },
        },
      });
      this.toolbar.mount();

      this.agentPreviewController = new AgentPreviewController({
        adapter: this.adapter,
        getContextInput: (instruction) => this.buildAgentContextInput(instruction),
        getOperationState: () => this.operationState,
        setOperationState: (state) => {
          this.operationState = state;
          this.syncPageCustomizationOperations();
          this.updateSaveButton();
        },
        onStateChange: (state) => {
          if (this.agentPanel?.isOpen()) {
            this.agentPanel.renderState(state);
          }
        },
        onDebug: this.onDebug,
      });

      this.agentPanel = new AgentPanel({
        shadowRoot,
        isAvailable: () => isLocalAgentAvailable(),
        callbacks: {
          onSubmit: (instruction) => {
            void this.agentPreviewController?.requestPreview(instruction);
          },
          onApprove: () => {
            void this.agentPreviewController?.approvePreview();
          },
          onReject: () => {
            this.agentPreviewController?.rejectPreview();
            this.clearAgentSelectionOverride();
          },
          onRefine: (instruction) => {
            void this.agentPreviewController?.refinePreview(instruction);
          },
          onCancel: () => {
            this.agentPreviewController?.cancelPendingRequest();
          },
          onClose: () => {
            this.agentPreviewController?.rejectPreview();
            this.clearAgentSelectionOverride();
          },
        },
      });
      this.agentPanel.mount();
    }

    this.selectionController = createSelectionController({
      getGraph: () => {
        if (!this.cacheController) {
          throw new Error("EditSession is not started");
        }
        return this.cacheController.cache.getGraph() ?? this.cacheController.cache.ensureFresh();
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
    this.restorePersistedGroupSelection();
  }

  private restorePersistedGroupSelection(): void {
    const groupState = findLatestPersistedGroupState(
      this.computePageKey(),
      getAppliedOperations(this.operationState),
    );
    if (!groupState || !this.selectionController) {
      return;
    }

    const restored = this.selectionController.restorePersistedGroup(groupState);
    if (restored?.group) {
      this.lastPersistedGroupId = restored.group.id;
      this.lastGroupedSelectionSnapshot = {
        selection: {
          ...restored.selection,
          selectedNodeIds: [...restored.selection.selectedNodeIds],
        },
        resolvedNodes: [...restored.resolvedNodes],
      };
      this.onDebug("group-restore", {
        groupId: restored.group.id,
        memberCount: restored.group.memberIds.length,
      });
    }
  }

  afterExternalClearPage(): void {
    this.closeInPlaceTextEditor(true);
    this.cancelStylePreview();
    this.operationState = clearAllOperations();
    this.sessionHistory = createSessionHistory();
    this.transformController?.setCropMode(false);
    this.selectionController?.clearSelectionAndGroup();
    this.transformController?.clearSelection();
    this.closeToolbar();
    this.shell.clearOverlays();
    this.updateSaveButton();
    this.lastSelectionKey = null;
    this.textEditTarget = null;
    this.lastGroupedSelectionSnapshot = null;
    this.lastPersistedGroupId = null;
    this.clearAgentSelectionOverride();
  }

  private syncPageCustomizationOperations(): void {
    this.pageCustomization.setPageOperations([
      ...this.operationState.savedOperations,
      ...this.operationState.draftOperations,
    ]);
  }

  private recordOperations(operations: EditorOperation[]): void {
    if (operations.length === 0) {
      return;
    }

    const snapshot = this.adapter?.buildBatchSnapshot(operations) ?? createEmptyBatchSnapshot();
    this.sessionHistory = recordHistoryBatch(this.sessionHistory, operations, snapshot);
    const ephemeral = this.usesEphemeralSelectionTargets();
    if (ephemeral) {
      this.onDebug("ephemeral-surface-not-persistable", {
        count: operations.length,
        note: "skipped draft tracking for ephemeral dropdown/popover surface",
      });
    } else {
      this.operationState = appendDraftOperations(this.operationState, operations);
      this.syncPageCustomizationOperations();
    }
    this.updateSaveButton();
    this.updateToolbar();
  }

  private usesEphemeralSelectionTargets(): boolean {
    const targets = this.transformController?.getTargets() ?? [];
    return targets.some((target) => {
      const element = target.element?.isConnected
        ? target.element
        : matchElementBySignature(this.root, target.signature);
      return element ? isInsideEphemeralSurface(element, this.root) : false;
    });
  }

  async saveAll(): Promise<boolean> {
    if (!hasUnsavedChanges(this.operationState)) {
      return false;
    }

    const draftCount = unsavedChangeCount(this.operationState);
    const nextState = promoteAllDraftToSaved(this.operationState);
    this.pageCustomization.setPageOperations(nextState.savedOperations);

    const persist = await this.pageCustomization.syncOperationsToStorage();
    if (!persist.ok) {
      this.syncPageCustomizationOperations();
      this.onDebug("explicit-save-failed", {
        pageKey: this.computePageKey(),
        error: persist.error,
        draftCount,
      });
      return false;
    }

    this.operationState = nextState;
    this.updateSaveButton();
    const savedZIndex = nextState.savedOperations.filter(
      (operation): operation is ZIndexOperation => operation.type === "zIndex",
    );
    logZIndexBatchDiagnostics(this.onDebug, "saved", savedZIndex);
    if (persist.capReached) {
      this.onDebug("save-cap-reached", {
        pageKey: this.computePageKey(),
        trimmed: persist.trimmed ?? 0,
        capReached: true,
        operationCount: persist.operationCount,
      });
    }
    this.onDebug("explicit-save", {
      pageKey: this.computePageKey(),
      savedCount: nextState.savedOperations.length,
      draftPromoted: draftCount,
      capReached: persist.capReached === true,
    });
    return true;
  }

  async clearPage(): Promise<boolean> {
    this.saveWindowController?.cancel();
    this.cancelStylePreview();
    const cleared = await this.pageCustomization.clearPage((operationId, error) => {
      this.onDebug("clear-page-revert-failed", { operationId, error });
    });
    if (!cleared) {
      this.onDebug("clear-page-failed", { pageKey: this.computePageKey() });
      return false;
    }
    this.operationState = clearAllOperations();
    this.sessionHistory = createSessionHistory();
    this.transformController?.setCropMode(false);
    this.selectionController?.clearSelectionAndGroup();
    this.transformController?.clearSelection();
    this.closeToolbar();
    this.shell.clearOverlays();
    this.updateSaveButton();
    this.lastSelectionKey = null;
    this.textEditTarget = null;
    this.lastGroupedSelectionSnapshot = null;
    this.lastPersistedGroupId = null;
    this.clearAgentSelectionOverride();
    this.onDebug("clear-page", { pageKey: this.computePageKey() });
    return true;
  }

  stop(): void {
    if (this.interactMode) {
      this.interactMode = false;
      this.pointerPipeline?.setPassThrough(false);
      this.shell.setSessionMode("edit");
    }
    this.resetActiveInteractionState();
    this.closeInPlaceTextEditor(true);
    this.cancelStylePreview();
    this.pointerPipeline?.detach();
    this.pointerPipeline = null;
    this.detachKeyHandler();
    this.toolbar?.unmount();
    this.toolbar = null;
    this.commandRegistry = null;
    this.styleTextController = null;
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
    this.lastSelectionResult = null;
    this.agentPanel?.close();
    this.agentPreviewController?.rejectPreview();
    this.detachPageIdentityHooks();
    this.detachBeforeUnloadGuard();
    this.syncPageCustomizationOperations();
    this.operationState = createSessionOperationState();
    this.sessionHistory = createSessionHistory();
    this.shell.setSaveButton({ visible: false, count: 0 });
    this.toolbarOpen = false;
    this.perf.reset();
    this.saveWindowController = null;
    this.agentPanel?.unmount();
    this.agentPanel = null;
    this.agentPreviewController = null;
  }

  isInteractMode(): boolean {
    return this.interactMode;
  }

  getPerformanceSamples(kind?: Parameters<PerformanceInstrumentation["getSamples"]>[0]) {
    return this.perf.getSamples(kind);
  }

  toggleInteractMode(): void {
    this.setInteractMode(!this.interactMode);
  }

  setInteractMode(enabled: boolean): void {
    if (this.interactMode === enabled) {
      return;
    }

    if (enabled) {
      this.interactMode = true;
      this.pointerPipeline?.setPassThrough(true);
      this.shell.setSessionMode("interact");
      this.resetActiveInteractionState();
      this.closeInPlaceTextEditor(true);
      this.cancelStylePreview();
      this.closeToolbar();
      this.shell.clearOverlays();
      this.onDebug("interact-mode", { enabled: true });
      return;
    }

    this.interactMode = false;
    this.pointerPipeline?.setPassThrough(false);
    this.shell.setSessionMode("edit");
    this.transformController?.refreshSelectionOutline();
    this.updateToolbar();
    this.onDebug("interact-mode", { enabled: false });
  }

  resetActiveInteractionState(): void {
    this.saveWindowController?.cancel();
    if (this.activeGesture) {
      this.releasePointerCapture(this.activeGesture.pointerId);
      this.activeGesture = null;
    }
    this.movePending = false;
    this.moveActive = false;
    this.cancelPendingLassoFrame();
    this.shell.renderLassoBox(null);
    this.transformController?.cancelActiveTransform();
    this.transformController?.setCropMode(false);
  }

  private cancelPendingLassoFrame(): void {
    const view = this.root.defaultView;
    if (this.lassoFrameId !== null && view && typeof view.cancelAnimationFrame === "function") {
      view.cancelAnimationFrame(this.lassoFrameId);
    }
    this.lassoFrameId = null;
    this.pendingLassoRect = null;
  }

  hideSelection(): void {
    const operations = this.transformController?.hideSelection() ?? [];
    if (operations.length === 0) {
      this.onDebug("hide-noop", { reason: "already-hidden-or-no-targets" });
      return;
    }

    this.clearSelection();
  }

  applyLayerCommand(command: LayerCommand): void {
    this.transformController?.applyLayerCommand(command);
  }

  toggleCropMode(): boolean {
    const enabled = this.transformController?.toggleCropMode() ?? false;
    this.updateToolbar();
    return enabled;
  }

  isCropMode(): boolean {
    return this.transformController?.isCropMode() ?? false;
  }

  canCropSelection(): boolean {
    return this.transformController?.canCropSelection() ?? false;
  }

  canEditTextSelection(): boolean {
    return this.resolveTextEditSelection().ok;
  }

  canStartSaveWindow(): boolean {
    return (
      !this.interactMode &&
      !this.isSaveWindowActive() &&
      this.operationState.draftOperations.length > 0
    );
  }

  isSaveWindowActive(): boolean {
    return this.saveWindowController?.isActive() ?? false;
  }

  startSaveWindow(): boolean {
    if (!this.canStartSaveWindow()) {
      return false;
    }

    this.resetActiveInteractionState();
    this.clearSelection();
    this.closeToolbar();
    return this.saveWindowController?.start() ?? false;
  }

  clearSelection(): void {
    this.closeInPlaceTextEditor(true);
    this.cancelStylePreview();
    this.selectionController?.clearSelection();
    this.transformController?.clearSelection();
    this.transformController?.setCropMode(false);
    this.closeToolbar();
    this.shell.clearOverlays();
  }

  undo(): boolean {
    const popped = popUndoBatch(this.sessionHistory);
    const batch = popped.batch;
    if (!batch || !this.adapter) {
      return false;
    }

    const restore = this.adapter.restoreBatchSnapshot(batch.snapshot, "before");
    if (restore.restored === 0 && batch.snapshot.elements.length > 0) {
      this.onDebug("undo-restore-failed", {
        count: batch.operations.length,
        restored: restore.restored,
        failed: restore.failed,
      });
      return false;
    }

    this.sessionHistory = popped.history;

    const ids = new Set(batch.operations.map((operation) => operation.id));
    this.operationState = removeDraftOperationsById(this.operationState, ids);
    this.transformController?.refreshSelectionOutline();
    this.updateSaveButton();
    this.updateToolbar();
    this.onDebug("undo", { count: batch.operations.length });
    return true;
  }

  redo(): boolean {
    const popped = popRedoBatch(this.sessionHistory);
    const batch = popped.batch;
    if (!batch || !this.adapter) {
      return false;
    }

    const restore = this.adapter.restoreBatchSnapshot(batch.snapshot, "after");
    if (restore.restored === 0 && batch.snapshot.elements.length > 0) {
      this.onDebug("redo-restore-failed", {
        count: batch.operations.length,
        restored: restore.restored,
        failed: restore.failed,
      });
      return false;
    }

    this.sessionHistory = popped.history;

    this.operationState = appendDraftOperations(this.operationState, batch.operations);
    this.transformController?.refreshSelectionOutline();
    this.updateSaveButton();
    this.updateToolbar();
    this.onDebug("redo", { count: batch.operations.length });
    return true;
  }

  canUndo(): boolean {
    return canUndo(this.sessionHistory);
  }

  canRedo(): boolean {
    return canRedo(this.sessionHistory);
  }

  hasUnsavedChanges(): boolean {
    return hasUnsavedChanges(this.operationState);
  }

  getUnsavedChangeCount(): number {
    return unsavedChangeCount(this.operationState);
  }

  applyStyle(property: StyleProperty, value: string): void {
    this.styleTextController?.applyStyle(property, value);
    this.transformController?.refreshSelectionOutline();
  }

  private previewStyle(property: StyleProperty, value: string): void {
    this.styleTextController?.previewStyle(property, value);
    this.transformController?.refreshSelectionOutline();
  }

  private applyStylePreview(): void {
    this.styleTextController?.commitStylePreview();
    this.transformController?.refreshSelectionOutline();
    this.updateToolbar();
  }

  private cancelStylePreview(): void {
    this.styleTextController?.cancelStylePreview();
    this.transformController?.refreshSelectionOutline();
  }

  applyText(value: string): void {
    this.styleTextController?.applyText(value);
    this.transformController?.refreshSelectionOutline();
  }

  openTextEditor(clientX?: number, clientY?: number): void {
    this.closeInPlaceTextEditor(false);
    const resolution = this.resolveTextEditSelection(clientX, clientY);

    if (!resolution.ok) {
      this.onDebug("text-edit-refused", {
        reason: resolution.reason,
        detail: resolution.detail,
      });
      return;
    }

    this.onDebug("text-edit-target", {
      reason: resolution.reason,
      tag: resolution.element.tagName.toLowerCase(),
      originalTag: resolution.originalElement?.tagName.toLowerCase(),
    });
    this.textEditTarget = resolution.target;
    if (!this.styleTextController) {
      return;
    }

    const initialText = this.styleTextController.readTextForTarget(resolution.target);
    if (this.openInPlaceTextEditor(resolution.element, resolution.target, initialText)) {
      return;
    }

    this.toolbar?.openTextEditor(resolution.target.rect, initialText);
  }

  private resolveTextEditSelection(clientX?: number, clientY?: number) {
    const handleTarget = this.transformController?.getHandleTarget() ?? null;
    const orderedTargets = [
      ...(handleTarget ? [handleTarget] : []),
      ...(this.transformController?.getTargets() ?? []).filter(
        (target) => target.nodeId !== handleTarget?.nodeId,
      ),
    ];

    for (const target of orderedTargets) {
      const selectedElement = target.element?.isConnected
        ? target.element
        : matchElementBySignature(this.root, target.signature);
      const resolution =
        clientX !== undefined && clientY !== undefined
          ? resolveTextEditTargetAtPoint(this.root, clientX, clientY, selectedElement, target)
          : resolveTextEditTargetForSelection(this.root, selectedElement, target);
      if (resolution.ok) {
        return resolution;
      }
    }

    return { ok: false as const, reason: "no-target" as const, detail: "no-safe-text-descendant" };
  }

  private handleSelectionChange(
    selection: EditorSelection,
    result: SelectionResolveResult,
  ): void {
    const selectionKey = selectionKeyFrom(selection);
    const selectionChanged = this.lastSelectionKey !== null && selectionKey !== this.lastSelectionKey;
    if (selectionChanged || selection.selectedNodeIds.length === 0) {
      this.cancelStylePreview();
      this.transformController?.setCropMode(false);
      this.closeToolbar();
    }
    this.lastSelectionKey = selectionKey;
    this.lastSelectionResult = result;
    if (!this.transformController) {
      return;
    }

    const input = toTransformSelectionInput(result);
    this.transformController.setSelection(input);
    this.updateToolbar();
  }

  private updateSaveButton(): void {
    const dirty = hasUnsavedChanges(this.operationState);
    this.shell.setSaveButton({
      visible: dirty,
      count: unsavedChangeCount(this.operationState),
      onSave: () => {
        void this.saveAll();
      },
    });
  }

  private updateToolbar(): void {
    if (this.interactMode) {
      this.closeToolbar();
      return;
    }

    if (!this.toolbar || !this.commandRegistry) {
      return;
    }

    const context = this.buildCommandContext();
    const hasSelection = context.selection.selectedNodeIds.length > 0;
    if (!hasSelection) {
      this.closeToolbar();
      return;
    }

    if (!this.toolbarOpen) {
      this.toolbar.hide();
      return;
    }

    const commands = TOOLBAR_COMMAND_IDS.flatMap((id) => {
      const command = this.commandRegistry?.get(id);
      if (!command) {
        return [];
      }
      return [{
        command,
        enabled: this.commandRegistry?.isEnabled(id, context) ?? false,
      }];
    });

    this.toolbar.renderCommands(commands, this.getAnchorRect(), {
      "crop-mode": this.isCropMode(),
    });

    if (this.toolbar.isStylePanelOpen()) {
      this.toolbar.setStylePanelValues(this.readStylePanelValues());
    }
  }

  private toggleToolbar(): void {
    if (this.toolbar?.isStylePanelOpen() || this.toolbar?.isTextEditorOpen()) {
      return;
    }

    if (this.toolbarOpen) {
      this.closeToolbar();
      return;
    }

    this.openToolbar();
  }

  private openToolbar(): void {
    const selection = this.selectionController?.getSelection();
    if (!selection || selection.selectedNodeIds.length === 0 || !this.toolbar) {
      return;
    }

    this.toolbarOpen = true;
    this.updateToolbar();
  }

  private closeToolbar(): void {
    this.toolbarOpen = false;
    this.toolbar?.hide();
  }

  private shouldIgnoreToolbarShortcut(event: KeyboardEvent): boolean {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const target of path) {
      if (!(target instanceof Element)) {
        continue;
      }

      if (target.getAttribute("data-otf-ui") === "style-panel") {
        return true;
      }

      if (target.closest("[data-otf-ui='style-panel']")) {
        return true;
      }

      if (target.closest("[data-otf-ui='agent-panel']")) {
        return true;
      }

      if (target.closest("[data-otf-ui='text-editor']")) {
        return true;
      }
    }

    if (event.target instanceof Element) {
      if (this.isElementInsideExtensionUi(event.target) || isTextEntryElement(event.target)) {
        return true;
      }
    }

    const activeElement = this.root.activeElement;
    if (activeElement && (
      this.isElementInsideExtensionUi(activeElement) ||
      isTextEntryElement(activeElement)
    )) {
      return true;
    }

    const shadowActive = this.shell.getShadowRoot()?.activeElement;
    if (shadowActive instanceof Element) {
      return true;
    }

    return false;
  }

  private isElementInsideExtensionUi(element: Element): boolean {
    return (
      element.getAttribute("data-otf-ui") !== null ||
      element.closest("[data-otf-ui]") !== null ||
      element.id === "on-the-fly-root-host"
    );
  }

  private canToggleToolbarFromKeyboard(event: KeyboardEvent): boolean {
    if (this.shouldIgnoreToolbarShortcut(event)) {
      return false;
    }

    if (this.toolbar?.isStylePanelOpen() || this.toolbar?.isTextEditorOpen()) {
      return false;
    }

    if (
      this.transformController?.isTransforming() ||
      this.transformController?.isCropMode() ||
      this.movePending ||
      this.moveActive
    ) {
      return false;
    }

    const selection = this.selectionController?.getSelection();
    return Boolean(selection && selection.selectedNodeIds.length > 0);
  }

  private readStylePanelValues(): Partial<Record<string, string>> {
    const target = this.transformController?.getHandleTarget()
      ?? this.transformController?.getTargets()[0];
    if (!target || !this.styleTextController) {
      return {};
    }

    return {
      backgroundColor: this.styleTextController.readStyleForTarget(target, "backgroundColor"),
      backgroundImage: this.styleTextController.readStyleForTarget(target, "backgroundImage"),
      color: this.styleTextController.readStyleForTarget(target, "color"),
      fontSize: this.styleTextController.readStyleForTarget(target, "fontSize"),
      fontWeight: this.styleTextController.readStyleForTarget(target, "fontWeight"),
      borderRadius: this.styleTextController.readStyleForTarget(target, "borderRadius"),
      boxShadow: this.styleTextController.readStyleForTarget(target, "boxShadow"),
      opacity: this.styleTextController.readStyleForTarget(target, "opacity"),
    };
  }

  private toggleStylePanel(): void {
    if (!this.toolbar || !this.toolbarOpen) {
      return;
    }

    const open = !this.toolbar.isStylePanelOpen();
    this.toolbar.toggleStylePanel(open, open ? this.readStylePanelValues() : undefined);
    this.updateToolbar();
  }

  private async executeCommand(commandId: string): Promise<void> {
    const registry = this.commandRegistry;
    if (!registry) {
      return;
    }

    if (commandId === "style-panel") {
      this.toggleStylePanel();
      return;
    }

    if (commandId === "crop-mode") {
      this.toggleCropMode();
      return;
    }

    const context = this.buildCommandContext();
    await registry.execute(commandId, context);
    this.transformController?.refreshSelectionOutline();
    this.updateToolbar();
  }

  private buildCommandContext(): CommandContext {
    const graph = this.cacheController?.cache.getGraph() ?? this.cacheController?.cache.ensureFresh();
    const selection = this.selectionController?.getSelection() ?? {
      selectedNodeIds: [],
      source: "click" as const,
    };

    const visualNodes = new Map<VisualNodeId, VisualNode>();
    if (graph) {
      for (const node of graph.getNodes()) {
        visualNodes.set(node.id, node);
      }
    }

    return {
      selection,
      visualNodes,
      applyOperation: (operation) => {
        if (!this.adapter) {
          return;
        }
        const result = this.adapter.applyOperation(operation);
        if (result.ok) {
          this.recordOperations([operation]);
        }
      },
      openPanel: (panelId) => {
        if (panelId === "style") {
          this.toggleStylePanel();
        }
      },
    };
  }

  private getAnchorRect(): VisualNodeRect | null {
    const selection = this.transformController?.getSelection();
    if (selection && selection.outlineRects.length > 0) {
      return selection.outlineRects[0] ?? null;
    }

    const node = this.lastSelectionResult?.resolvedNodes[0];
    return node ? { ...node.rect } : null;
  }

  private computePageKey(): string {
    return this.pageCustomization.getPageKey();
  }

  private attachPageIdentityHooks(): void {
    this.pageCustomization.setFlushBeforePageKeyChange(async () => {
      if (!hasUnsavedChanges(this.operationState)) {
        return;
      }
      const saved = await this.saveAll();
      if (!saved) {
        this.onDebug("page-identity-flush-failed", {
          pageKey: this.pageCustomization.getPageKey(),
        });
      }
    });
    this.pageCustomization.setAfterPageKeyChange((next, previous) => {
      this.operationState = createSessionOperationState([
        ...this.pageCustomization.getPageOperations(),
      ]);
      this.sessionHistory = createSessionHistory();
      this.lastClickTime = 0;
      this.lastClickNodeId = null;
      this.lastSelectionKey = null;
      this.lastPersistedGroupId = null;
      this.lastGroupedSelectionSnapshot = null;
      this.clearAgentSelectionOverride();
      this.clearSelection();
      this.updateSaveButton();
      this.onDebug("page-identity-session-reset", { previous, next });
    });
  }

  private detachPageIdentityHooks(): void {
    this.pageCustomization.setFlushBeforePageKeyChange(null);
    this.pageCustomization.setAfterPageKeyChange(null);
  }

  private attachBeforeUnloadGuard(): void {
    const view = this.root.defaultView;
    if (!view || this.beforeUnloadHandler) {
      return;
    }
    this.beforeUnloadHandler = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges(this.operationState)) {
        return;
      }
      event.preventDefault();
      // Chrome still requires returnValue to show the leave-page prompt.
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- beforeunload dialog
      event.returnValue = "";
    };
    view.addEventListener("beforeunload", this.beforeUnloadHandler);
  }

  private detachBeforeUnloadGuard(): void {
    const view = this.root.defaultView;
    if (view && this.beforeUnloadHandler) {
      view.removeEventListener("beforeunload", this.beforeUnloadHandler);
    }
    this.beforeUnloadHandler = null;
  }

  groupSelection(): void {
    const result = this.selectionController?.groupSelection();
    if (result?.group) {
      this.lastGroupedSelectionSnapshot = {
        selection: {
          ...result.selection,
          selectedNodeIds: [...result.selection.selectedNodeIds],
        },
        resolvedNodes: [...result.resolvedNodes],
      };
      this.lastPersistedGroupId = result.group.id;
      const operation = buildGroupOperation(result.group, {
        pageKey: this.computePageKey(),
        createId: createOperationId,
        sourceCommand: "group",
      });
      this.recordOperations([operation]);
      this.onDebug("group", {
        grouped: true,
        memberCount: result.group.memberIds.length,
        rejectionReason: result.rejectionReason,
      });
    }
  }

  ungroupSelection(): void {
    const activeGroup = this.selectionController?.getActiveGroup();
    const groupId = activeGroup?.id ?? this.lastPersistedGroupId;
    const result = this.selectionController?.ungroupSelection();
    if (result) {
      if (groupId) {
        const operation = buildUngroupOperation(groupId, {
          pageKey: this.computePageKey(),
          createId: createOperationId,
          sourceCommand: "ungroup",
        });
        this.recordOperations([operation]);
        this.lastPersistedGroupId = null;
      }
      this.lastGroupedSelectionSnapshot = null;
      this.onDebug("ungroup", {
        memberCount: result.resolvedNodes.length,
        rejectionReason: result.rejectionReason,
      });
    }
  }

  private copySelectionToClipboard(): boolean {
    const targets = this.transformController?.getTargets() ?? [];
    if (targets.length === 0) {
      this.onDebug("editor-clipboard-copy-skipped", { reason: "no-selection" });
      return false;
    }

    const entries = captureEditorClipboard(targets, (target) => this.resolveClipboardElement(target));
    if (entries.length === 0) {
      this.onDebug("editor-clipboard-copy-skipped", {
        reason: "no-resolvable-elements",
        targetCount: targets.length,
      });
      return false;
    }

    this.editorClipboard = entries;
    this.onDebug("editor-clipboard-copy", { copiedCount: entries.length });
    return true;
  }

  private pasteClipboardDuplicates(): boolean {
    const clipboard = this.editorClipboard;
    if (!clipboard || clipboard.length === 0) {
      this.onDebug("editor-clipboard-paste-skipped", { reason: "empty-clipboard" });
      return false;
    }

    const adapter = this.adapter;
    if (!adapter) {
      this.onDebug("editor-clipboard-paste-skipped", { reason: "no-adapter" });
      return false;
    }

    const pageKey = this.computePageKey();
    const { operations, cloneTargets } = createDuplicateOperations(
      clipboard,
      pageKey,
      createOperationId,
    );

    if (operations.length === 0) {
      this.onDebug("editor-clipboard-paste-skipped", { reason: "no-operations-built" });
      return false;
    }

    const appliedTargets: TransformTarget[] = [];
    for (const operation of operations) {
      if (operation.type !== "duplicate") {
        continue;
      }
      const result = adapter.applyOperation(operation);
      if (!result.ok) {
        this.onDebug("editor-clipboard-paste-failed", {
          operationId: operation.id,
          error: result.error,
        });
        continue;
      }
      const clone = resolveDuplicateElement(this.root, operation.payload.cloneId);
      if (!clone) {
        continue;
      }
      const planned = cloneTargets.find((target) => target.nodeId === operation.payload.cloneId);
      const signature = planned?.signature ?? operation.target.signature;
      if (!signature) {
        continue;
      }
      appliedTargets.push({
        nodeId: operation.payload.cloneId,
        signature,
        rect: planned?.rect ?? {
          x: operation.payload.anchorLeft + operation.payload.offsetDx,
          y: operation.payload.anchorTop + operation.payload.offsetDy,
          width: operation.payload.anchorWidth,
          height: operation.payload.anchorHeight,
        },
        element: clone,
      });
    }

    if (appliedTargets.length === 0) {
      this.onDebug("editor-clipboard-paste-skipped", { reason: "apply-failed" });
      return false;
    }

    this.recordOperations(operations);
    this.transformController?.setSelection({
      targets: appliedTargets,
      outlineRects: appliedTargets.map((target) => ({ ...target.rect })),
      variant: appliedTargets.length > 1 ? "group" : "node",
      handleTarget: appliedTargets.length === 1 ? (appliedTargets[0] ?? null) : null,
    });
    this.cacheController?.cache.invalidate();
    this.onDebug("editor-clipboard-paste", {
      pastedCount: appliedTargets.length,
      saveStatus: "queued",
    });
    return true;
  }

  private resolveClipboardElement(target: TransformTarget): HTMLElement | null {
    if (target.element?.isConnected) {
      return target.element;
    }
    return matchElementBySignature(this.root, target.signature);
  }

  private shouldIgnoreClipboardShortcut(event: KeyboardEvent): boolean {
    if (this.toolbar?.isTextEditorOpen() || this.toolbar?.isStylePanelOpen()) {
      return true;
    }

    const path = getEventComposedPath(event);
    for (const target of path) {
      if (!(target instanceof Element)) {
        continue;
      }
      if (this.isElementInsideExtensionUi(target) || isTextEntryElement(target)) {
        return true;
      }
    }

    const activeElement = this.root.activeElement;
    return (
      activeElement instanceof Element &&
      (this.isElementInsideExtensionUi(activeElement) || isTextEntryElement(activeElement))
    );
  }

  private attachKeyHandler(windowRef: Window): void {
    if (this.keyHandler) {
      return;
    }

    this.keyHandler = (event: KeyboardEvent) => {
      if (this.inPlaceTextEdit) {
        this.handleInPlaceTextKey(event);
        return;
      }

      if (event.repeat) {
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "c" && !event.shiftKey) {
          if (!this.shouldIgnoreClipboardShortcut(event)) {
            if (this.copySelectionToClipboard()) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
          }
        }

        if (key === "v" && !event.shiftKey) {
          if (!this.shouldIgnoreClipboardShortcut(event)) {
            if (this.pasteClipboardDuplicates()) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
          }
        }
      }

      if (
        event.key.toLowerCase() === "t" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        if (!this.canToggleToolbarFromKeyboard(event)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.toggleToolbar();
        return;
      }

      if (
        event.key.toLowerCase() === "i" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        if (this.shouldIgnoreToolbarShortcut(event)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.toggleInteractMode();
        return;
      }

      const registry = this.commandRegistry;
      if (!registry) {
        return;
      }

      const context = this.buildCommandContext();
      const command = findCommandForKeyboardEvent(registry, event, context);
      if (command) {
        if (this.shouldIgnoreToolbarShortcut(event)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void this.executeCommand(command.id);
        return;
      }

      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "g") {
        const selection = this.selectionController?.getSelection();
        if (!selection) {
          return;
        }

        if (event.shiftKey) {
          if (!this.selectionController?.getActiveGroup()) {
            return;
          }
        } else if (selection.selectedNodeIds.length < 2) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          this.ungroupSelection();
        } else {
          this.groupSelection();
        }
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
    if (this.agentPanel?.isOpen()) {
      this.agentPreviewController?.rejectPreview();
      this.clearAgentSelectionOverride();
      this.agentPanel.close();
      return true;
    }

    if (this.saveWindowController?.isActive()) {
      this.saveWindowController.cancel();
      return true;
    }

    if (this.inPlaceTextEdit) {
      this.closeInPlaceTextEditor(true);
      return true;
    }

    if (this.toolbar?.isTextEditorOpen()) {
      this.toolbar.closeTextEditor(true);
      return true;
    }

    if (this.toolbar?.isStylePanelOpen()) {
      this.toolbar.closeStylePanel();
      this.updateToolbar();
      return true;
    }

    if (
      this.activeGesture ||
      this.transformController?.isTransforming() ||
      this.transformController?.isCropMode() ||
      this.movePending ||
      this.moveActive
    ) {
      this.resetActiveInteractionState();
      this.updateToolbar();
      return true;
    }

    if (this.interactMode) {
      this.setInteractMode(false);
      return true;
    }

    if (this.toolbarOpen) {
      this.closeToolbar();
      return true;
    }

    const selection = this.selectionController?.getSelection();
    if (selection && selection.selectedNodeIds.length > 0) {
      this.clearSelection();
      return true;
    }

    return false;
  }

  private handlePointerDown(event: PointerEvent): void {
    if (this.interactMode) {
      return;
    }

    if (this.saveWindowController?.handlePointerDown(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (this.inPlaceTextEdit && event.target !== this.inPlaceTextEdit.element) {
      this.closeInPlaceTextEditor(false);
    }

    if (this.transformController?.isTransforming()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (this.transformController?.isCropMode()) {
      if (!(this.transformController.hitTestSelection(event.clientX, event.clientY))) {
        this.transformController.setCropMode(false);
        this.updateToolbar();
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (this.activeGesture) {
      return;
    }

    this.activeGesture = beginPointerGesture(
      event.pointerId,
      event.clientX,
      event.clientY,
      event.shiftKey,
      event.altKey,
    );
    const currentSelection = this.selectionController?.getSelection();
    if (currentSelection) {
      this.clickSelectionSnapshot = {
        selection: {
          ...currentSelection,
          selectedNodeIds: [...currentSelection.selectedNodeIds],
        },
        resolvedNodes: [...(this.lastSelectionResult?.resolvedNodes ?? [])],
      };
    } else {
      this.clickSelectionSnapshot = null;
    }
    this.movePending =
      !event.shiftKey &&
      !event.altKey &&
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
    if (this.interactMode) {
      return;
    }

    if (this.saveWindowController?.handlePointerMove(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

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
      this.pendingLassoRect = normalizeLassoRect(
        this.activeGesture.startX,
        this.activeGesture.startY,
        event.clientX,
        event.clientY,
      );
      this.scheduleLassoRender();
    }
  }

  private scheduleLassoRender(): void {
    const view = this.root.defaultView;
    if (!view || typeof view.requestAnimationFrame !== "function") {
      if (this.pendingLassoRect) {
        this.shell.renderLassoBox(this.pendingLassoRect);
      }
      return;
    }

    if (this.lassoFrameId !== null) {
      return;
    }

    if (this.pendingLassoRect) {
      this.shell.renderLassoBox(this.pendingLassoRect);
    }

    this.lassoFrameId = view.requestAnimationFrame(() => {
      this.lassoFrameId = null;
      if (this.pendingLassoRect) {
        this.shell.renderLassoBox(this.pendingLassoRect);
      }
    });
  }

  private handlePointerUp(event: PointerEvent): void {
    if (this.interactMode) {
      return;
    }

    if (this.saveWindowController?.handlePointerUp(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!this.activeGesture || event.pointerId !== this.activeGesture.pointerId) {
      return;
    }

    const gesture = this.activeGesture;
    const wasMoveActive = this.moveActive;
    this.movePending = false;
    this.moveActive = false;
    this.cancelPendingLassoFrame();

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
      const endLasso = this.perf.begin("lasso");
      const result = this.selectionController.handleLasso(
        gesture.startX,
        gesture.startY,
        event.clientX,
        event.clientY,
        gesture.shiftKey,
      );
      endLasso();
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

    const endSelection = this.perf.begin("selection");
    const result = this.selectionController.handlePointerClick(
      event.clientX,
      event.clientY,
      gesture.shiftKey,
      composedPath,
      gesture.altKey,
    );
    endSelection();
    this.onDebug("click-resolve", {
      count: result.resolvedNodes.length,
      source: result.selection.source,
      rejectionReason: result.rejectionReason,
      altKey: gesture.altKey,
    });
    this.shell.renderLassoBox(null);

    this.handleClickDoubleTap(result, gesture.shiftKey, event.clientX, event.clientY);
  }

  private handleClickDoubleTap(
    result: SelectionResolveResult,
    _shiftKey: boolean,
    clientX: number,
    clientY: number,
  ): void {
    const clickedNodeId = result.resolvedNodes[0]?.id ?? null;
    const now = Date.now();
    const isSameTargetDoubleClick =
      clickedNodeId !== null &&
      clickedNodeId === this.lastClickNodeId &&
      now - this.lastClickTime <= DOUBLE_CLICK_MS;
    const isSameSpotDoubleClick =
      now - this.lastClickTime <= DOUBLE_CLICK_MS &&
      Math.abs(clientX - this.lastClickX) <= 8 &&
      Math.abs(clientY - this.lastClickY) <= 8;
    const isDoubleClick = isSameTargetDoubleClick || isSameSpotDoubleClick;

    this.lastClickTime = now;
    this.lastClickNodeId = clickedNodeId;
    this.lastClickX = clientX;
    this.lastClickY = clientY;

    if (!isDoubleClick) {
      this.firstClickSelectionSnapshot = this.clickSelectionSnapshot;
      return;
    }

    const agentContext = this.resolveAgentSelectionForDoubleClick(
      clickedNodeId,
      result,
      clientX,
      clientY,
    );
    this.firstClickSelectionSnapshot = null;
    if (!agentContext) {
      return;
    }

    this.agentSelectionOverride = agentContext.selection;
    this.agentSelectedNodesOverride = agentContext.nodes;
    this.reapplyAgentSelection(agentContext);

    if (isLocalAgentAvailable()) {
      this.openAgentPanel(clientX, clientY);
    } else {
      this.onDebug("agent-disabled", { reason: "public-build" });
    }
  }

  private reapplyAgentSelection(agentContext: {
    selection: EditorSelection;
    nodes: VisualNode[];
  }): void {
    if (!this.selectionController) {
      return;
    }

    const activeGroup = this.selectionController.getActiveGroup();
    if (
      agentContext.selection.activeGroupId &&
      activeGroup?.id === agentContext.selection.activeGroupId
    ) {
      return;
    }

    if (agentContext.selection.activeGroupId) {
      const restored = this.selectionController.restorePersistedGroup({
        groupId: agentContext.selection.activeGroupId,
        memberNodeIds: [...agentContext.selection.selectedNodeIds],
        memberSignatures: agentContext.nodes.map((node) => node.signature),
      });
      if (restored) {
        return;
      }
    }

    this.selectionController.applySelectionSnapshot(
      agentContext.selection,
      agentContext.nodes,
      null,
    );
  }

  private resolveAgentSelectionForDoubleClick(
    clickedNodeId: VisualNodeId | null,
    result: SelectionResolveResult,
    clientX: number,
    clientY: number,
  ): { selection: EditorSelection; nodes: VisualNode[] } | null {
    const candidates = [
      this.lastGroupedSelectionSnapshot,
      this.firstClickSelectionSnapshot,
      this.clickSelectionSnapshot,
    ].filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== null);
    const snapshot = candidates
      .filter((entry) =>
        this.snapshotContainsAgentClickTarget(entry, clickedNodeId, result, clientX, clientY),
      )
      .sort(
        (left, right) => right.selection.selectedNodeIds.length - left.selection.selectedNodeIds.length,
      )[0];

    if (
      snapshot &&
      (snapshot.selection.activeGroupId || snapshot.selection.selectedNodeIds.length > 1)
    ) {
      const selectedIds = new Set(snapshot.selection.selectedNodeIds);
      const graph = this.cacheController?.cache.getGraph();
      const nodes = snapshot.selection.selectedNodeIds
        .map(
          (nodeId) =>
            graph?.getNodeById(nodeId) ??
            snapshot.resolvedNodes.find((node) => node.id === nodeId),
        )
        .filter((node): node is VisualNode => node !== undefined);
      const resolvedNodes =
        nodes.length >= snapshot.selection.selectedNodeIds.length
          ? nodes
          : snapshot.resolvedNodes.filter((node) => selectedIds.has(node.id));
      if (resolvedNodes.length > 0) {
        return { selection: snapshot.selection, nodes: resolvedNodes };
      }
    }

    const currentSelection = this.selectionController?.getSelection();
    if (
      clickedNodeId &&
      currentSelection &&
      currentSelection.selectedNodeIds.length === 1 &&
      currentSelection.selectedNodeIds[0] === clickedNodeId
    ) {
      return { selection: currentSelection, nodes: result.resolvedNodes };
    }

    if (
      clickedNodeId &&
      currentSelection &&
      currentSelection.selectedNodeIds.includes(clickedNodeId) &&
      (currentSelection.activeGroupId || currentSelection.selectedNodeIds.length > 1)
    ) {
      const nodes = result.resolvedNodes.filter((node) =>
        currentSelection.selectedNodeIds.includes(node.id),
      );
      if (nodes.length > 0) {
        return { selection: currentSelection, nodes };
      }
    }

    return null;
  }

  private snapshotContainsAgentClickTarget(
    snapshot: {
      selection: EditorSelection;
      resolvedNodes: VisualNode[];
    },
    clickedNodeId: VisualNodeId | null,
    result: SelectionResolveResult,
    clientX: number,
    clientY: number,
  ): boolean {
    if (clickedNodeId && snapshot.selection.selectedNodeIds.includes(clickedNodeId)) {
      return true;
    }

    const clickedNode = result.resolvedNodes[0];
    const clickedElement =
      clickedNode?.element ??
      (clickedNode ? matchElementBySignature(this.root, clickedNode.signature) : null);
    if (clickedElement) {
      for (const node of snapshot.resolvedNodes) {
        const memberElement =
          node.element?.isConnected === true
            ? node.element
            : matchElementBySignature(this.root, node.signature);
        if (memberElement?.contains(clickedElement)) {
          return true;
        }
      }
    }

    if (
      snapshot.selection.activeGroupId ||
      snapshot.selection.selectedNodeIds.length > 1
    ) {
      return snapshot.resolvedNodes.some((node) => pointInRect(clientX, clientY, node.rect));
    }

    return false;
  }

  private openAgentPanel(clientX: number, clientY: number): void {
    if (!isLocalAgentAvailable() || !this.agentPanel || !this.agentPreviewController) {
      return;
    }

    this.agentPanel.open({ x: clientX, y: clientY });
    this.agentPanel.renderState(this.agentPreviewController.getState());
  }

  private buildAgentContextInput(instruction: string): AgentContextInput | null {
    const selection =
      this.agentSelectionOverride ?? this.selectionController?.getSelection();
    const graph = this.cacheController?.cache.getGraph();
    if (!selection || selection.selectedNodeIds.length === 0 || !graph) {
      return null;
    }

    const selectedNodes =
      this.agentSelectedNodesOverride && this.agentSelectedNodesOverride.length > 0
        ? this.agentSelectedNodesOverride
        : selection.selectedNodeIds
            .map((nodeId) => graph.getNodeById(nodeId))
            .filter((node): node is VisualNode => node !== undefined);

    if (selectedNodes.length === 0) {
      return null;
    }

    return {
      pageKey: this.computePageKey(),
      instruction,
      selection: {
        ...selection,
        selectedNodeIds: [...selection.selectedNodeIds],
      },
      selectedNodes,
      graph,
      existingOperations: [
        ...this.operationState.savedOperations,
        ...this.operationState.draftOperations,
      ],
    };
  }

  private clearAgentSelectionOverride(): void {
    this.agentSelectionOverride = null;
    this.agentSelectedNodesOverride = null;
    this.lastGroupedSelectionSnapshot = null;
  }

  private handlePointerCancel(event: PointerEvent): void {
    if (this.interactMode) {
      return;
    }

    if (this.saveWindowController?.handlePointerCancel(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!this.activeGesture || event.pointerId !== this.activeGesture.pointerId) {
      return;
    }

    this.resetActiveInteractionState();
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

  private openInPlaceTextEditor(
    element: HTMLElement,
    target: TransformTarget,
    initialText: string,
  ): boolean {
    if (!element.isConnected || element.isContentEditable) {
      return false;
    }

    const previousContentEditable = element.getAttribute("contenteditable");
    const previousUserSelect = element.style.userSelect;
    const multiline = initialText.includes("\n") || target.rect.height > 44;

    const blurHandler = (): void => {
      this.closeInPlaceTextEditor(false);
    };
    const keyHandler = (event: KeyboardEvent): void => {
      this.handleInPlaceTextKey(event);
    };

    this.inPlaceTextEdit = {
      element,
      target,
      originalText: initialText,
      previousContentEditable,
      previousUserSelect,
      multiline,
      finished: false,
      keyHandler,
      blurHandler,
    };
    this.textEditTarget = target;

    element.setAttribute("contenteditable", "plaintext-only");
    if (element.getAttribute("contenteditable") !== "plaintext-only") {
      element.setAttribute("contenteditable", "true");
    }
    element.style.userSelect = "text";
    element.focus({ preventScroll: true });
    selectElementText(element);
    element.addEventListener("keydown", keyHandler);
    element.addEventListener("blur", blurHandler);
    this.onDebug("text-edit-in-place", {
      tag: element.tagName.toLowerCase(),
      multiline,
    });
    return true;
  }

  private handleInPlaceTextKey(event: KeyboardEvent): void {
    const state = this.inPlaceTextEdit;
    if (!state || state.finished) {
      return;
    }

    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      this.closeInPlaceTextEditor(false);
      return;
    }

    if (event.key === "Enter" && !state.multiline && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.closeInPlaceTextEditor(false);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.closeInPlaceTextEditor(true);
    }
  }

  private closeInPlaceTextEditor(cancel: boolean): void {
    const state = this.inPlaceTextEdit;
    if (!state || state.finished) {
      return;
    }

    state.finished = true;
    state.element.removeEventListener("keydown", state.keyHandler);
    state.element.removeEventListener("blur", state.blurHandler);
    const nextText = extractEditableText(state.element);
    restoreContentEditable(state.element, state.previousContentEditable);
    state.element.style.userSelect = state.previousUserSelect;
    clearSelectionRange(state.element.ownerDocument);
    this.inPlaceTextEdit = null;

    if (cancel) {
      state.element.textContent = state.originalText;
      this.textEditTarget = null;
      return;
    }

    if (nextText !== state.originalText) {
      state.element.textContent = state.originalText;
      this.textEditTarget = state.target;
      this.applyText(nextText);
    }

    this.textEditTarget = null;
  }
}

export function createEditSession(options: EditSessionOptions): EditSession {
  return new EditSession(options);
}

function selectionKeyFrom(selection: EditorSelection): string {
  return `${selection.selectedNodeIds.join(",")}:${selection.activeGroupId ?? ""}`;
}

function pointInRect(x: number, y: number, rect: VisualNodeRect): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
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

function selectElementText(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection();
  if (!selection) {
    return;
  }
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function clearSelectionRange(document: Document): void {
  document.getSelection()?.removeAllRanges();
}

function restoreContentEditable(element: HTMLElement, previous: string | null): void {
  if (previous === null) {
    element.removeAttribute("contenteditable");
    return;
  }
  element.setAttribute("contenteditable", previous);
}

function isTextEntryElement(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") {
    return true;
  }

  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }

  return element.closest("[contenteditable='true'], [contenteditable='plaintext-only']") !== null;
}
