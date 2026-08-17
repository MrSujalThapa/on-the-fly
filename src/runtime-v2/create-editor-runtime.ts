import type { EditorOperation, MoveOperation } from "../editor/operations.js";
import type { VisualNodeId } from "../editor/ids.js";
import { computeDocumentPageKey } from "../content/page-identity.js";
import {
  loadPageOperations,
  replacePageOperations,
} from "../content/storage-client.js";
import { waitForDocumentReady } from "../editor/dom/replay-readiness.js";
import { OTF_TRANSFORM_ATTR } from "../editor/dom/types.js";
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
import type { ExecutionResult } from "./operation-executor.js";
import type { IntendedRect } from "./placement-engine.js";
import { summarizeIdentity } from "./visual-identity.js";
import { isResolvedVisual } from "./visual-model.js";

const MOVE_THRESHOLD_PX = 3;

interface MovingGesture {
  nodeId: VisualNodeId;
  element: HTMLElement;
  startPointer: { x: number; y: number };
  startRect: IntendedRect;
  styleSnapshot: string | null;
  committedTransform: string;
}

function isMoveOperation(value: { type: string }): value is MoveOperation {
  return value.type === "move";
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
  let selected: VisualNodeId | null = null;
  let gesture: MovingGesture | null = null;
  let ignoreMutations = false;
  let previousUserSelect = "";
  let resizeObserver: ResizeObserver | null = null;

  const pageKey = (): string => computeDocumentPageKey(root);

  const refreshSave = (): void => {
    overlays.setSave({
      visible: ledger.isDirty(),
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

  const observeSelected = (): void => {
    resizeObserver?.disconnect();
    if (!selected) {
      return;
    }
    const element = visualModel.bind(selected);
    if (!element || !root.defaultView) {
      return;
    }
    resizeObserver = new ResizeObserver(() => {
      overlays.refreshFromLiveGeometry();
    });
    resizeObserver.observe(element);
  };

  const selectNode = (nodeId: VisualNodeId | null): void => {
    selected = nodeId;
    if (nodeId) {
      overlays.showSelection([nodeId]);
    } else {
      overlays.clear();
    }
    observeSelected();
  };

  const reapplyActive = (): void => {
    ignoreMutations = true;
    try {
      for (const operation of ledger.activeOperations()) {
        if (!isMoveOperation(operation)) {
          continue;
        }
        const identity = operation.target.signature
          ? { signature: operation.target.signature }
          : null;
        if (!identity) {
          continue;
        }
        if (operation.target.nodeId) {
          visualModel.invalidate(operation.target.nodeId);
        }
        const resolved = visualModel.resolveIdentity(identity);
        if (!isResolvedVisual(resolved)) {
          logV2("reapply-identity", {
            owner: "IDENTITY",
            id: operation.id,
            kind: resolved.kind,
            evidence: resolved.evidence,
          });
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
      ignoreMutations = false;
    }
    if (selected) {
      overlays.showSelection([selected]);
    }
  };

  const restorePreview = (): void => {
    if (!gesture || !gesture.element.isConnected) {
      return;
    }
    if (gesture.styleSnapshot) {
      gesture.element.setAttribute("style", gesture.styleSnapshot);
      return;
    }
    gesture.element.removeAttribute("style");
  };

  const applyPreview = (dx: number, dy: number): void => {
    if (!gesture || !gesture.element.isConnected) {
      return;
    }
    restorePreview();
    const extra = `translate(${String(dx)}px, ${String(dy)}px)`;
    gesture.element.style.transform = gesture.committedTransform
      ? `${gesture.committedTransform} ${extra}`
      : extra;
  };

  const cancelGesture = (): void => {
    restorePreview();
    gesture = null;
    overlays.refreshFromLiveGeometry();
  };

  const pointInRect = (x: number, y: number, rect: IntendedRect): boolean => {
    return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height;
  };

  const onPointerDown = (event: NormalizedPointer): void => {
    if (event.target instanceof Element && isExtensionRoot(event.target)) {
      return;
    }
    const selectedElement = selected ? visualModel.bind(selected) : null;
    const selectedNode = selected ? visualModel.get(selected) : null;
    if (
      selected &&
      selectedElement &&
      selectedNode &&
      (selectedNode.role === "collection" || selectedNode.role === "section") &&
      pointInRect(event.clientX, event.clientY, rectFromElement(selectedElement))
    ) {
      gesture = {
        nodeId: selected,
        element: selectedElement,
        startPointer: { x: event.clientX, y: event.clientY },
        startRect: rectFromElement(selectedElement),
        styleSnapshot: selectedElement.getAttribute("style"),
        committedTransform: selectedElement.style.transform,
      };
      return;
    }

    const nodeId = visualModel.pick(event.clientX, event.clientY);
    if (!nodeId) {
      selectNode(null);
      return;
    }
    const element = visualModel.bind(nodeId);
    if (!element) {
      selectNode(null);
      return;
    }
    selectNode(nodeId);
    gesture = {
      nodeId,
      element,
      startPointer: { x: event.clientX, y: event.clientY },
      startRect: rectFromElement(element),
      styleSnapshot: element.getAttribute("style"),
      committedTransform: element.style.transform,
    };
  };

  const onPointerMove = (event: NormalizedPointer): void => {
    if (!gesture) {
      return;
    }
    if (!gesture.element.isConnected) {
      cancelGesture();
      return;
    }
    const dx = event.clientX - gesture.startPointer.x;
    const dy = event.clientY - gesture.startPointer.y;
    if (Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) {
      return;
    }
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
    restorePreview();
    gesture = null;

    if (!active.element.isConnected || Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) {
      overlays.refreshFromLiveGeometry();
      refreshSave();
      return;
    }

    ignoreMutations = true;
    const result = executor.executeMove({
      nodeId: active.nodeId,
      dx,
      dy,
      pageKey: pageKey(),
    });
    ignoreMutations = false;
    logV2("move", {
      owner: result.ok ? "EXECUTION" : "EXECUTION",
      ok: result.ok,
      dx,
      dy,
      nodeId: active.nodeId,
      error: result.ok ? undefined : result.error,
    });
    selectNode(active.nodeId);
    refreshSave();
    overlays.refreshFromLiveGeometry();
    if (!result.ok) {
      logV2("move-failed", { owner: "EXECUTION", error: result.error });
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      if (gesture) {
        cancelGesture();
      } else {
        selectNode(null);
      }
      event.preventDefault();
      return;
    }
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      runtime.selectParent();
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
      if (ignoreMutations || gesture) {
        return;
      }
      const relevant = records.some((record) => {
        if (record.type !== "childList") {
          return false;
        }
        const node = record.target;
        if (node instanceof Element && isExtensionRoot(node)) {
          return false;
        }
        return true;
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
      attributes: false,
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
            selectNode(null);
            applyUserSelect(false);
          } else {
            applyUserSelect(true);
          }
          refreshSave();
        },
      });
      attachInvalidation();
      if (selected) {
        overlays.showSelection([selected]);
      }
    },
    stop() {
      cancelGesture();
      resizeObserver?.disconnect();
      resizeObserver = null;
      overlays.unmount();
      input.stop();
      owner().dispose();
      started = false;
      selected = null;
    },
    select(element) {
      const nodeId = visualModel.adopt(element);
      selectNode(nodeId);
      return nodeId;
    },
    selectParent() {
      if (!selected) {
        return null;
      }
      const parentId = visualModel.parentOf(selected);
      if (!parentId) {
        return null;
      }
      const parent = visualModel.get(parentId);
      if (!parent || parent.role === "root") {
        return null;
      }
      selectNode(parentId);
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
      ignoreMutations = false;
      if (result.ok) {
        selectNode(nodeId);
      }
      refreshSave();
      overlays.refreshFromLiveGeometry();
      return result;
    },
    undo() {
      const operation = ledger.peekUndo();
      if (!operation || !isMoveOperation(operation)) {
        return { ok: false, error: "nothing_to_undo", rolledBack: false };
      }
      ignoreMutations = true;
      const result = executor.revertCommitted(operation);
      ignoreMutations = false;
      if (result.ok) {
        ledger.confirmUndo();
      }
      refreshSave();
      overlays.refreshFromLiveGeometry();
      return result;
    },
    redo() {
      const operation = ledger.peekRedo();
      if (!operation || !isMoveOperation(operation)) {
        return { ok: false, error: "nothing_to_redo", rolledBack: false };
      }
      ignoreMutations = true;
      const result = executor.reapplyCommitted(operation);
      ignoreMutations = false;
      if (result.ok) {
        ledger.confirmRedo();
      }
      refreshSave();
      overlays.refreshFromLiveGeometry();
      return result;
    },
    async save(): Promise<PersistResult> {
      const projection = JSON.parse(JSON.stringify(ledger.activeOperations())) as EditorOperation[];
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
      ledger.markPersisted();
      refreshSave();
      return { ok: true };
    },
    async replay(): Promise<ReplayResult> {
      await waitForDocumentReady(root);
      const loaded = await loadPageOperations(pageKey());
      let applied = 0;
      let unresolved = 0;
      let failed = 0;
      let failureKind: ReplayResult["failureKind"];
      const succeeded: MoveOperation[] = [];
      ignoreMutations = true;
      logV2("replay-start", {
        owner: "LEDGER",
        pageKey: pageKey(),
        loadedIds: loaded.map((operation) => operation.id),
      });
      for (const operation of loaded) {
        if (!isMoveOperation(operation)) {
          continue;
        }
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
          succeeded.push(operation);
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
      ignoreMutations = false;
      ledger.hydratePersisted(succeeded);
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
