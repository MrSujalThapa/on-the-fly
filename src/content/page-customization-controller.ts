import { createDomRuntimeAdapter, type DomRuntimeAdapter } from "../editor/dom/dom-runtime-adapter.js";
import type { EditorOperation } from "../editor/operations.js";
import type { PageKey } from "../editor/ids.js";
import {
  clearPageOperations,
  loadPageOperations,
  replacePageOperations,
} from "./storage-client.js";

export interface PageCustomizationReplayResult {
  pageKey: PageKey;
  count: number;
  failed: number;
  resolved: number;
  unresolved: number;
}

/**
 * Applies saved page customizations on load (outside edit mode) and owns the
 * shared DOM adapter for the tab lifetime.
 */
export class PageCustomizationController {
  private readonly adapter: DomRuntimeAdapter;
  private readonly pageKey: PageKey;
  private replayed = false;
  private pageOperations: EditorOperation[] = [];
  private replayPromise: Promise<PageCustomizationReplayResult> | null = null;
  /**
   * Bumped whenever live state is reset (clear). Replay captures the current
   * value before its async storage read and becomes a no-op if the token
   * changed while it was awaiting, so a clear that lands mid-replay can never be
   * overwritten by stale operations.
   */
  private replayGeneration = 0;
  /** True while a clear is in progress; replay must not apply operations. */
  private clearing = false;

  constructor(private readonly root: Document) {
    this.adapter = createDomRuntimeAdapter(root);
    this.pageKey = computePageKey(root);
  }

  getAdapter(): DomRuntimeAdapter {
    return this.adapter;
  }

  getPageKey(): PageKey {
    return this.pageKey;
  }

  isReplayed(): boolean {
    return this.replayed;
  }

  getPageOperations(): readonly EditorOperation[] {
    return this.pageOperations;
  }

  setPageOperations(operations: EditorOperation[]): void {
    this.pageOperations = [...operations];
  }

  ensureReplayed(
    onDebug?: (message: string, data?: unknown) => void,
  ): Promise<PageCustomizationReplayResult> {
    this.replayPromise ??= this.replay(onDebug);
    return this.replayPromise;
  }

  private async replay(
    onDebug?: (message: string, data?: unknown) => void,
  ): Promise<PageCustomizationReplayResult> {
    if (this.clearing) {
      return { pageKey: this.pageKey, count: 0, failed: 0, resolved: 0, unresolved: 0 };
    }

    if (this.replayed) {
      return {
        pageKey: this.pageKey,
        count: this.pageOperations.length,
        failed: 0,
        resolved: this.pageOperations.length,
        unresolved: 0,
      };
    }

    const generation = this.replayGeneration;
    const operations = await loadPageOperations(this.pageKey);

    // A clear (or other live-state reset) landed while we were awaiting the
    // storage read. The loaded operations are now stale, so applying them would
    // re-introduce mutations that clear already removed. Bail without touching
    // the DOM or persisted/session operation state.
    if (generation !== this.replayGeneration) {
      onDebug?.("page-replay-cancelled", {
        pageKey: this.pageKey,
        reason: "generation-changed",
      });
      return { pageKey: this.pageKey, count: 0, failed: 0, resolved: 0, unresolved: 0 };
    }

    this.pageOperations = [...operations];
    this.replayed = true;

    if (operations.length === 0) {
      onDebug?.("page-replay", { pageKey: this.pageKey, count: 0, durationMs: 0 });
      return { pageKey: this.pageKey, count: 0, failed: 0, resolved: 0, unresolved: 0 };
    }

    const replayStartedAt = performance.now();
    const batch = this.adapter.replayOperationsWithDiagnostics(operations);
    const durationMs = performance.now() - replayStartedAt;
    const failed = batch.results.filter((result) => !result.ok).length;
    const resolved = batch.diagnostics.filter((entry) => entry.resolved).length;
    const unresolved = batch.diagnostics.length - resolved;

    for (const entry of batch.diagnostics) {
      onDebug?.("page-replay-op", entry);
    }

    onDebug?.("page-replay", {
      pageKey: this.pageKey,
      count: operations.length,
      failed,
      resolved,
      unresolved,
      durationMs,
    });

    return { pageKey: this.pageKey, count: operations.length, failed, resolved, unresolved };
  }

  /**
   * Pragmatic hard reset: delete persisted operations, drop all in-memory
   * state, then force a clean page reload so any residual live DOM mutations
   * are wiped by the browser. The reload only happens once persisted deletion
   * has succeeded. Returns true when the page reload was triggered.
   */
  async clearPage(
    onRevertFailure?: (operationId: string, error: string) => void,
  ): Promise<boolean> {
    // Mark the clear in progress and invalidate any in-flight replay
    // synchronously, before the first await, so a replay resuming during this
    // method's own async work sees the new token (and the clearing flag) and
    // cancels instead of re-applying old operations.
    this.clearing = true;
    this.replayGeneration += 1;
    this.replayPromise = null;
    this.replayed = true;
    this.pageOperations = [];

    const deleted = await clearPageOperations(this.pageKey);

    // Always drop in-memory effect/operation state so live state is clean even
    // in degraded contexts and stale replay can never reuse old effects.
    this.adapter.clearAppliedEffects(onRevertFailure);
    this.clearing = false;

    if (!deleted) {
      // Persisted operations are still on disk; reloading now would just replay
      // them again. Surface the failure and leave the page as-is.
      console.error(
        "[on-the-fly] clear page failed: persisted operations were not deleted; skipping reload",
      );
      return false;
    }

    this.reloadPage();
    return true;
  }

  private reloadPage(): void {
    try {
      this.root.defaultView?.location.reload();
    } catch {
      // Reload may be unavailable in non-browser/degraded contexts; ignore.
    }
  }

  async syncOperationsToStorage(): Promise<void> {
    await replacePageOperations(this.pageKey, this.pageOperations);
  }
}

export function computePageKey(root: Document): PageKey {
  const location = root.defaultView?.location;
  if (location) {
    return `${location.origin}${location.pathname}`;
  }
  return "otf://unknown";
}
