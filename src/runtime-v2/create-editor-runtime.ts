import type { EditorOperation, MoveOperation } from "../editor/operations.js";
import { computeDocumentPageKey } from "../content/page-identity.js";
import {
  loadPageOperations,
  replacePageOperations,
} from "../content/storage-client.js";
import { waitForDocumentReady } from "../editor/dom/replay-readiness.js";
import { isExtensionRoot } from "../editor/measurement/scan-guards.js";
import { createElementRegistry } from "./create-element-registry.js";
import { createOperationExecutor } from "./create-operation-executor.js";
import { createOperationLedger } from "./create-operation-ledger.js";
import { createOverlayCoordinator } from "./create-overlay-coordinator.js";
import { createPlacementEngine } from "./create-placement-engine.js";
import { DisposableOwner } from "./disposable-owner.js";
import type { EditorRuntime, PersistResult, ReplayResult } from "./editor-runtime.js";
import type { ElementHandle } from "./element-registry.js";
import { isResolvedElement } from "./element-registry.js";
import { rectFromElement, rectsNear } from "./geometry.js";
import type { ExecutionResult } from "./operation-executor.js";
import type { IntendedRect } from "./placement-engine.js";
import { hitElementAt } from "./pointer-hit.js";

const MOVE_THRESHOLD_PX = 3;

interface MovingGesture {
  handle: ElementHandle;
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
  const registry = createElementRegistry(root);
  const placement = createPlacementEngine();
  const ledger = createOperationLedger();
  const executor = createOperationExecutor({
    document: root,
    registry,
    ledger,
    placement,
  });
  const overlays = createOverlayCoordinator({ document: root, registry });

  const ownerHolder: { current: DisposableOwner } = { current: new DisposableOwner() };
  const owner = (): DisposableOwner => ownerHolder.current;
  let started = false;
  let selected: ElementHandle | null = null;
  let gesture: MovingGesture | null = null;
  let rafId = 0;
  let ignoreMutations = false;
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

  const cancelRaf = (): void => {
    if (rafId !== 0) {
      root.defaultView?.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const invalidateOverlay = (): void => {
    const view = root.defaultView;
    if (!view) {
      overlays.refreshFromLiveGeometry();
      return;
    }
    if (rafId !== 0) {
      return;
    }
    rafId = view.requestAnimationFrame(() => {
      rafId = 0;
      overlays.refreshFromLiveGeometry();
    });
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
    invalidateOverlay();
  };

  const observeSelected = (): void => {
    resizeObserver?.disconnect();
    if (!selected) {
      return;
    }
    const resolved = registry.resolve(selected);
    if (!isResolvedElement(resolved) || !root.defaultView) {
      return;
    }
    resizeObserver = new ResizeObserver(() => {
      invalidateOverlay();
    });
    resizeObserver.observe(resolved.element);
  };

  const selectHandle = (handle: ElementHandle): void => {
    selected = handle;
    overlays.showSelection([handle]);
    observeSelected();
  };

  const reapplyActive = (): void => {
    ignoreMutations = true;
    try {
      for (const operation of ledger.activeOperations()) {
        if (!isMoveOperation(operation)) {
          continue;
        }
        const handle: ElementHandle | null = operation.target.signature
          ? { id: operation.id, signature: operation.target.signature }
          : null;
        if (!handle) {
          continue;
        }
        registry.invalidate(handle);
        const resolved = registry.resolve(handle);
        if (!isResolvedElement(resolved)) {
          continue;
        }
        const expected = operation.metadata?.finalRect;
        if (expected && rectsNear(rectFromElement(resolved.element), expected)) {
          registry.cache(handle, resolved.element);
          continue;
        }
        const result = executor.replayMove(operation);
        logV2("reapply", { ok: result.ok, id: operation.id });
      }
    } finally {
      ignoreMutations = false;
    }
    if (selected) {
      overlays.showSelection([selected]);
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!started || event.button !== 0) {
      return;
    }
    if (event.target instanceof Element && isExtensionRoot(event.target)) {
      return;
    }
    const hit = hitElementAt(root, event.clientX, event.clientY);
    if (!hit) {
      selected = null;
      overlays.clear();
      return;
    }
    event.preventDefault();
    const handle = registry.register(hit);
    selectHandle(handle);
    gesture = {
      handle,
      element: hit,
      startPointer: { x: event.clientX, y: event.clientY },
      startRect: rectFromElement(hit),
      styleSnapshot: hit.getAttribute("style"),
      committedTransform: hit.style.transform,
    };
  };

  const onPointerMove = (event: PointerEvent): void => {
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
    invalidateOverlay();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!gesture) {
      return;
    }
    const active = gesture;
    const dx = event.clientX - active.startPointer.x;
    const dy = event.clientY - active.startPointer.y;
    restorePreview();
    gesture = null;

    if (!active.element.isConnected || Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) {
      invalidateOverlay();
      refreshSave();
      return;
    }

    ignoreMutations = true;
    const result = executor.executeMove({
      handle: active.handle,
      dx,
      dy,
      pageKey: pageKey(),
    });
    ignoreMutations = false;
    logV2("move", { ok: result.ok, dx, dy });
    selectHandle(active.handle);
    refreshSave();
    invalidateOverlay();
    if (!result.ok) {
      logV2("move-failed", { error: result.error });
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!started) {
      return;
    }
    if (event.key === "Escape") {
      cancelGesture();
      event.preventDefault();
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
      invalidateOverlay();
    }, true);
    owner().listen(root, "scroll", () => {
      invalidateOverlay();
    }, true);
    owner().listen(view, "resize", () => {
      invalidateOverlay();
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
      invalidateOverlay();
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
    registry,
    placement,
    executor,
    ledger,
    overlays,
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
        invalidateOverlay();
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
      const view = root.defaultView;
      if (view) {
        const html = root.documentElement;
        const previousUserSelect = html.style.userSelect;
        html.style.userSelect = "none";
        owner().add(() => {
          html.style.userSelect = previousUserSelect;
        });
        owner().listen(view, "pointerdown", onPointerDown as EventListener, true);
        owner().listen(view, "pointermove", onPointerMove as EventListener, true);
        owner().listen(view, "pointerup", onPointerUp as EventListener, true);
        owner().listen(view, "pointercancel", () => {
          cancelGesture();
        }, true);
        owner().listen(view, "keydown", onKeyDown as EventListener, true);
      }
      attachInvalidation();
      if (selected) {
        overlays.showSelection([selected]);
      }
    },
    stop() {
      cancelGesture();
      cancelRaf();
      resizeObserver?.disconnect();
      resizeObserver = null;
      overlays.unmount();
      owner().dispose();
      started = false;
      selected = null;
    },
    select(element: HTMLElement) {
      const handle = registry.register(element);
      selectHandle(handle);
      return handle;
    },
    move(handle: ElementHandle, dx: number, dy: number): ExecutionResult {
      ignoreMutations = true;
      const result = executor.executeMove({
        handle,
        dx,
        dy,
        pageKey: pageKey(),
      });
      ignoreMutations = false;
      if (result.ok) {
        selectHandle(handle);
      }
      refreshSave();
      invalidateOverlay();
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
      invalidateOverlay();
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
      invalidateOverlay();
      return result;
    },
    async save(): Promise<PersistResult> {
      const projection = JSON.parse(JSON.stringify(ledger.activeOperations())) as EditorOperation[];
      const persist = await replacePageOperations(pageKey(), projection);
      if (!persist.ok) {
        logV2("save-failed", { error: persist.error });
        return { ok: false, error: persist.error ?? "save_failed" };
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
      const succeeded: MoveOperation[] = [];
      ignoreMutations = true;
      for (const operation of loaded) {
        if (!isMoveOperation(operation)) {
          continue;
        }
        const result = executor.replayMove(operation);
        if (result.ok) {
          applied += 1;
          succeeded.push(operation);
          continue;
        }
        if (result.error === "unresolved_target" || result.error === "ambiguous_target") {
          unresolved += 1;
        } else {
          failed += 1;
        }
        logV2("replay-item-failed", { id: operation.id, error: result.error });
      }
      ignoreMutations = false;
      ledger.hydratePersisted(succeeded);
      const ok = unresolved === 0 && failed === 0;
      logV2("replay", { ok, applied, unresolved, failed, total: loaded.length });
      return { ok, applied, unresolved, failed };
    },
  };

  return runtime;
}
