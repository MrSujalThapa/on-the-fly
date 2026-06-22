import { createDomRuntimeAdapter, type DomRuntimeAdapter } from "../editor/dom/dom-runtime-adapter.js";
import type { EditorOperation } from "../editor/operations.js";
import type { PageKey } from "../editor/ids.js";
import {
  clearPageOperations,
  loadPageOperations,
  replacePageOperations,
} from "./storage-client.js";
import { appendOperations as mergeOperations } from "./session-history.js";

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

  recordAppliedOperations(operations: EditorOperation[]): void {
    if (operations.length === 0) {
      return;
    }
    this.pageOperations = mergeOperations(this.pageOperations, operations);
  }

  removeOperationsById(ids: ReadonlySet<string>): void {
    this.pageOperations = this.pageOperations.filter((operation) => !ids.has(operation.id));
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
    if (this.replayed) {
      return {
        pageKey: this.pageKey,
        count: this.pageOperations.length,
        failed: 0,
        resolved: this.pageOperations.length,
        unresolved: 0,
      };
    }

    const operations = await loadPageOperations(this.pageKey);
    this.pageOperations = [...operations];
    this.replayed = true;

    if (operations.length === 0) {
      onDebug?.("page-replay", { pageKey: this.pageKey, count: 0 });
      return { pageKey: this.pageKey, count: 0, failed: 0, resolved: 0, unresolved: 0 };
    }

    const batch = this.adapter.replayOperationsWithDiagnostics(operations);
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
    });

    return { pageKey: this.pageKey, count: operations.length, failed, resolved, unresolved };
  }

  async clearPage(): Promise<void> {
    await clearPageOperations(this.pageKey);
    this.adapter.clearAppliedEffects();
    this.pageOperations = [];
    this.replayed = true;
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
