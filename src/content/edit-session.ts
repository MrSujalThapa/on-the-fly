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
import type { EditorOperation, StyleProperty } from "../editor/operations.js";
import type { CommandContext } from "../editor/editor-command.js";
import {
  CommandRegistry,
  createCommandRegistry,
  findCommandForKeyboardEvent,
} from "../editor/commands/command-registry.js";
import type { DomRuntimeAdapter } from "../editor/dom/dom-runtime-adapter.js";
import type { VisualNodeRect, VisualNode } from "../editor/visual-node.js";
import type { VisualNodeId } from "../editor/ids.js";
import { savePageOperations } from "./storage-client.js";
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
  appendOperations,
  canRedo,
  canUndo,
  createSessionHistory,
  popRedoBatch,
  popUndoBatch,
  recordHistoryBatch,
  removeOperationsById,
  type SessionHistory,
} from "./session-history.js";
import { createStyleTextController, StyleTextController } from "./style-text-controller.js";
import { FloatingToolbar } from "./floating-toolbar.js";
import {
  PageCustomizationController,
  computePageKey as computeDocumentPageKey,
} from "./page-customization-controller.js";
import {
  resolveTextEditTargetAtPoint,
  resolveTextEditTargetForSelection,
} from "../editor/style/text-target-resolver.js";

export interface EditSessionOptions {
  shell: EditorShell;
  root: Document;
  pageCustomization: PageCustomizationController;
  onDebug?: (message: string, data?: unknown) => void;
}

const DOUBLE_CLICK_MS = 400;

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
  private pageOperations: EditorOperation[] = [];
  private activeGesture: PointerGestureState | null = null;
  private captureTarget: HTMLElement | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;
  private movePending = false;
  private moveActive = false;
  private lastSelectionResult: SelectionResolveResult | null = null;
  private lastClickTime = 0;
  private lastClickNodeId: string | null = null;
  private lastSelectionKey: string | null = null;
  private textEditTarget: TransformTarget | null = null;

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
      cacheOptions: { root: this.root },
      listeners: {
        window: this.root.defaultView as Window,
        root: this.root,
      },
    });

    await this.pageCustomization.ensureReplayed(this.onDebug);
    this.adapter = this.pageCustomization.getAdapter();
    this.pageOperations = [...this.pageCustomization.getPageOperations()];

    this.transformController = createTransformController({
      shell: this.shell,
      document: this.root,
      adapter: this.adapter,
      getPageKey: () => this.computePageKey(),
      onApply: (operations) => {
        this.recordOperations(operations);
      },
      onDebug: this.onDebug,
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
            this.applyStyle(property, value);
          },
          onTextCommit: (value) => {
            this.applyText(value);
            this.textEditTarget = null;
          },
          onTextCancel: () => {
            this.textEditTarget = null;
          },
          onStylePanelClose: () => {
            this.updateToolbar();
          },
        },
      });
      this.toolbar.mount();
    }

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

  afterExternalClearPage(): void {
    this.pageOperations = [];
    this.sessionHistory = createSessionHistory();
    this.transformController?.setCropMode(false);
    this.selectionController?.clearSelection();
    this.transformController?.clearSelection();
    this.toolbar?.hide();
    this.shell.clearOverlays();
    this.lastSelectionKey = null;
    this.textEditTarget = null;
  }

  private recordOperations(operations: EditorOperation[]): void {
    if (operations.length === 0) {
      return;
    }

    this.sessionHistory = recordHistoryBatch(this.sessionHistory, operations);
    this.pageOperations = appendOperations(this.pageOperations, operations);
    this.pageCustomization.recordAppliedOperations(operations);
    this.persistOperations(operations);
    this.updateToolbar();
  }

  private persistOperations(operations: EditorOperation[]): void {
    if (operations.length === 0) {
      return;
    }

    const pageKey = this.computePageKey();
    void savePageOperations(pageKey, operations).then((result) => {
      if (!result.ok) {
        this.onDebug("storage-save-failed", {
          pageKey,
          error: result.error ?? "unknown",
          batchSize: operations.length,
        });
        return;
      }

      this.onDebug("storage-save", {
        pageKey,
        saved: result.saved ?? 0,
        skipped: result.skipped ?? 0,
        operationCount: result.operationCount ?? 0,
        trimmed: result.trimmed ?? 0,
        capReached: result.capReached === true,
        ...(result.capReached ? { warning: "operation_cap_reached" } : {}),
        ...(result.error ? { note: result.error } : {}),
      });
    });
  }

  async clearPage(): Promise<void> {
    await this.pageCustomization.clearPage();
    this.pageOperations = [];
    this.sessionHistory = createSessionHistory();
    this.transformController?.setCropMode(false);
    this.selectionController?.clearSelection();
    this.transformController?.clearSelection();
    this.toolbar?.hide();
    this.shell.clearOverlays();
    this.lastSelectionKey = null;
    this.textEditTarget = null;
    this.onDebug("clear-page", { pageKey: this.computePageKey() });
  }

  stop(): void {
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
    this.pageOperations = [];
    this.sessionHistory = createSessionHistory();
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

  clearSelection(): void {
    this.selectionController?.clearSelection();
    this.transformController?.clearSelection();
    this.toolbar?.closeStylePanel();
    this.toolbar?.hide();
    this.shell.clearOverlays();
  }

  undo(): boolean {
    const popped = popUndoBatch(this.sessionHistory);
    const batch = popped.batch;
    if (!batch || !this.adapter) {
      return false;
    }

    this.sessionHistory = popped.history;
    for (const operation of [...batch].reverse()) {
      this.adapter.revertOperation(operation);
    }

    const ids = new Set(batch.map((operation) => operation.id));
    this.pageOperations = removeOperationsById(this.pageOperations, ids);
    this.pageCustomization.setPageOperations(this.pageOperations);
    void this.pageCustomization.syncOperationsToStorage();
    this.transformController?.refreshSelectionOutline();
    this.updateToolbar();
    this.onDebug("undo", { count: batch.length });
    return true;
  }

  redo(): boolean {
    const popped = popRedoBatch(this.sessionHistory);
    const batch = popped.batch;
    if (!batch || !this.adapter) {
      return false;
    }

    this.sessionHistory = popped.history;
    for (const operation of batch) {
      this.adapter.applyOperation(operation);
    }

    this.pageOperations = appendOperations(this.pageOperations, batch);
    this.pageCustomization.recordAppliedOperations(batch);
    void savePageOperations(this.computePageKey(), batch);
    this.transformController?.refreshSelectionOutline();
    this.updateToolbar();
    this.onDebug("redo", { count: batch.length });
    return true;
  }

  canUndo(): boolean {
    return canUndo(this.sessionHistory);
  }

  canRedo(): boolean {
    return canRedo(this.sessionHistory);
  }

  applyStyle(property: StyleProperty, value: string): void {
    this.styleTextController?.applyStyle(property, value);
    this.transformController?.refreshSelectionOutline();
  }

  applyText(value: string): void {
    this.styleTextController?.applyText(value);
    this.transformController?.refreshSelectionOutline();
  }

  openTextEditor(clientX?: number, clientY?: number): void {
    const handleTarget = this.transformController?.getHandleTarget() ?? null;
    const selectedElement = handleTarget?.element ?? null;
    const resolution =
      clientX !== undefined && clientY !== undefined
        ? resolveTextEditTargetAtPoint(this.root, clientX, clientY, selectedElement, handleTarget)
        : resolveTextEditTargetForSelection(this.root, selectedElement, handleTarget);

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
    const rect = resolution.target.rect;
    if (!this.styleTextController || !this.toolbar) {
      return;
    }

    const initialText = this.styleTextController.readTextForTarget(resolution.target);
    this.toolbar.openTextEditor(rect, initialText);
  }

  private handleSelectionChange(
    selection: EditorSelection,
    result: SelectionResolveResult,
  ): void {
    const selectionKey = selectionKeyFrom(selection);
    if (
      this.lastSelectionKey !== null &&
      selectionKey !== this.lastSelectionKey &&
      this.toolbar?.isStylePanelOpen()
    ) {
      this.toolbar.closeStylePanel();
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

  private updateToolbar(): void {
    if (!this.toolbar || !this.commandRegistry) {
      return;
    }

    const context = this.buildCommandContext();
    const hasSelection = context.selection.selectedNodeIds.length > 0;
    if (!hasSelection) {
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

  private readStylePanelValues(): Partial<Record<string, string>> {
    const target = this.transformController?.getHandleTarget()
      ?? this.transformController?.getTargets()[0];
    if (!target || !this.styleTextController) {
      return {};
    }

    return {
      backgroundColor: this.styleTextController.readStyleForTarget(target, "backgroundColor"),
      color: this.styleTextController.readStyleForTarget(target, "color"),
      fontSize: this.styleTextController.readStyleForTarget(target, "fontSize"),
      fontWeight: this.styleTextController.readStyleForTarget(target, "fontWeight"),
      borderRadius: this.styleTextController.readStyleForTarget(target, "borderRadius"),
      opacity: this.styleTextController.readStyleForTarget(target, "opacity"),
    };
  }

  private toggleStylePanel(): void {
    if (!this.toolbar) {
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
  }

  private buildCommandContext(): CommandContext {
    const graph = this.cacheController?.cache.ensureFresh();
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
    return computeDocumentPageKey(this.root);
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
      if (event.repeat) {
        return;
      }

      const registry = this.commandRegistry;
      if (!registry) {
        return;
      }

      const context = this.buildCommandContext();
      const command = findCommandForKeyboardEvent(registry, event, context);
      if (command) {
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
    if (this.toolbar?.isTextEditorOpen()) {
      this.toolbar.closeTextEditor(true);
      return true;
    }

    if (this.toolbar?.isStylePanelOpen()) {
      this.toolbar.closeStylePanel();
      this.updateToolbar();
      return true;
    }

    if (this.transformController?.isTransforming()) {
      this.transformController.cancelMove();
      this.movePending = false;
      this.moveActive = false;
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
      gesture.altKey,
    );
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
    shiftKey: boolean,
    clientX: number,
    clientY: number,
  ): void {
    const nodeId = result.resolvedNodes[0]?.id ?? null;
    const now = Date.now();
    const isDoubleClick =
      nodeId !== null &&
      nodeId === this.lastClickNodeId &&
      now - this.lastClickTime <= DOUBLE_CLICK_MS;

    this.lastClickTime = now;
    this.lastClickNodeId = nodeId;

    if (!isDoubleClick || result.resolvedNodes.length !== 1) {
      return;
    }

    if (shiftKey) {
      this.onDebug("agent-disabled", { reason: "shift-double-click-reserved" });
      return;
    }

    this.openTextEditor(clientX, clientY);
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

function selectionKeyFrom(selection: EditorSelection): string {
  return `${selection.selectedNodeIds.join(",")}:${selection.activeGroupId ?? ""}`;
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
