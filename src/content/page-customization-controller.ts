import { createDomRuntimeAdapter, type DomRuntimeAdapter } from "../editor/dom/dom-runtime-adapter.js";
import { waitForDocumentReady, waitForReplayTargets } from "../editor/dom/replay-readiness.js";
import { sortOperationsForReplay } from "../editor/persistence/replay-operation-order.js";
import type { EditorOperation } from "../editor/operations.js";
import type { PageKey } from "../editor/ids.js";
import {
  clearPageOperations,
  loadPageOperations,
  replacePageOperations,
  type SavePageOperationsResult,
} from "./storage-client.js";
import {
  computeDocumentPageKey,
  createPageIdentity,
  type PageIdentity,
} from "./page-identity.js";

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
  private readonly identity: PageIdentity;
  private pageKey: PageKey;
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
  private replayDebug: ((message: string, data?: unknown) => void) | undefined;
  private flushBeforePageKeyChange:
    | ((previous: PageKey, next: PageKey) => Promise<void>)
    | null = null;
  private afterPageKeyChange: ((next: PageKey, previous: PageKey) => void) | null = null;
  private pageKeyChangeQueue: Promise<void> = Promise.resolve();
  private readonly unsubscribeIdentity: () => void;

  constructor(private readonly root: Document) {
    this.adapter = createDomRuntimeAdapter(root);
    this.identity = createPageIdentity(root);
    this.pageKey = this.identity.current();
    this.unsubscribeIdentity = this.identity.subscribe((next, previous) => {
      this.pageKeyChangeQueue = this.pageKeyChangeQueue
        .then(() => this.applyPageKeyChange(next, previous))
        .catch((error: unknown) => {
          this.replayDebug?.("page-identity-change-failed", {
            previous,
            next,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
  }

  getAdapter(): DomRuntimeAdapter {
    return this.adapter;
  }

  getPageKey(): PageKey {
    return this.pageKey;
  }

  setFlushBeforePageKeyChange(
    flush: ((previous: PageKey, next: PageKey) => Promise<void>) | null,
  ): void {
    this.flushBeforePageKeyChange = flush;
  }

  setAfterPageKeyChange(
    listener: ((next: PageKey, previous: PageKey) => void) | null,
  ): void {
    this.afterPageKeyChange = listener;
  }

  dispose(): void {
    this.unsubscribeIdentity();
    this.identity.dispose();
    this.flushBeforePageKeyChange = null;
    this.afterPageKeyChange = null;
  }

  whenPageKeySettled(): Promise<void> {
    return this.pageKeyChangeQueue;
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
    if (onDebug) {
      this.replayDebug = onDebug;
    }
    this.replayPromise ??= this.replay(onDebug ?? this.replayDebug);
    return this.replayPromise;
  }

  private async applyPageKeyChange(next: PageKey, previous: PageKey): Promise<void> {
    if (next === this.pageKey) {
      return;
    }

    this.replayDebug?.("page-identity-changed", { previous, next });
    await this.flushBeforePageKeyChange?.(previous, next);

    if (this.pageOperations.length > 0 && this.pageKey === previous) {
      const persist = await replacePageOperations(previous, this.pageOperations);
      if (!persist.ok) {
        this.replayDebug?.("page-identity-persist-failed", {
          pageKey: previous,
          error: persist.error,
        });
      }
    }

    this.pageKey = next;
    this.replayed = false;
    this.replayPromise = null;
    this.replayGeneration += 1;
    this.pageOperations = [];
    this.adapter.clearAppliedEffects();
    await this.ensureReplayed(this.replayDebug);
    this.afterPageKeyChange?.(next, previous);
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

    if (operations.length === 0) {
      this.replayed = true;
      onDebug?.("page-replay", { pageKey: this.pageKey, count: 0, durationMs: 0 });
      return { pageKey: this.pageKey, count: 0, failed: 0, resolved: 0, unresolved: 0 };
    }

    await waitForDocumentReady(this.root);
    const targetWait = await waitForReplayTargets(this.root, operations);
    onDebug?.("page-replay-target-wait", {
      pageKey: this.pageKey,
      resolved: targetWait.resolved,
      total: targetWait.total,
      timedOut: targetWait.timedOut,
    });

    if (generation !== this.replayGeneration) {
      onDebug?.("page-replay-cancelled", {
        pageKey: this.pageKey,
        reason: "generation-changed-after-target-wait",
      });
      return { pageKey: this.pageKey, count: 0, failed: 0, resolved: 0, unresolved: 0 };
    }

    this.replayed = true;

    const replayOperations = sortOperationsForReplay(operations);
    const replayStartedAt = performance.now();
    const batch = this.adapter.replayOperationsWithDiagnostics(replayOperations);
    const durationMs = performance.now() - replayStartedAt;
    const failed = batch.results.filter((result) => !result.ok).length;

    for (const entry of batch.diagnostics) {
      onDebug?.("page-replay-op", entry);
    }

    onDebug?.("page-replay", {
      pageKey: this.pageKey,
      count: operations.length,
      failed,
      applied: batch.applied,
      skipped: batch.skipped,
      resolved: batch.applied,
      unresolved: batch.unresolved,
      targetWait,
      durationMs,
    });

    return {
      pageKey: this.pageKey,
      count: operations.length,
      failed,
      resolved: batch.applied,
      unresolved: batch.unresolved,
    };
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

    const deleted = await clearPageOperations(this.pageKey);

    if (!deleted) {
      this.clearing = false;
      // Persisted operations are still on disk. Leave live DOM, in-memory
      // operations, and replay state untouched so the session can retry.
      console.error(
        "[on-the-fly] clear page failed: persisted operations were not deleted; skipping reload",
      );
      return false;
    }

    this.replayed = true;
    this.pageOperations = [];
    this.adapter.clearAppliedEffects(onRevertFailure);
    this.clearing = false;

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

  async syncOperationsToStorage(): Promise<SavePageOperationsResult> {
    const mismatch = this.pageOperations.some((operation) => operation.pageKey !== this.pageKey);
    if (mismatch) {
      this.replayDebug?.("page-key-mismatch", {
        pageKey: this.pageKey,
        operationKeys: [...new Set(this.pageOperations.map((operation) => operation.pageKey))],
      });
      return { ok: false, error: "page_key_mismatch" };
    }
    return replacePageOperations(this.pageKey, this.pageOperations);
  }
}

export function computePageKey(root: Document): PageKey {
  return computeDocumentPageKey(root);
}
