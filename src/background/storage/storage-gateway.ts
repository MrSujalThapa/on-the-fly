import type { EditorOperation } from "../../editor/operations.js";
import type { PageKey } from "../../editor/ids.js";
import {
  friendlyExportError,
  friendlyImportError,
  parseImportJson,
  serializeExportPayload,
  summarizeStorageUsage,
  validateExportPayload,
} from "../../shared/export-import.js";
import type {
  ExportDataResponse,
  ImportDataResponse,
  PageStateResponse,
  StorageMutationResponse,
  StorageUsageResponse,
} from "../../shared/storage-messages.js";
import { OperationStore } from "./operation-store.js";

let store: OperationStore | null = null;

function getStore(): OperationStore {
  if (store) {
    return store;
  }

  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) {
    throw new Error("indexeddb_unavailable");
  }

  store = new OperationStore({ indexedDB: factory });
  return store;
}

/** Test/seam hook: swap the backing store (e.g. fake-indexeddb in tests). */
export function setOperationStore(next: OperationStore | null): void {
  store = next;
}

export async function handleLoadPageState(pageKey: PageKey): Promise<PageStateResponse> {
  try {
    const operations = await getStore().loadOperations(pageKey);
    return {
      ok: true,
      pageKey,
      operations,
      operationCount: operations.length,
    };
  } catch (error) {
    return { ok: false, pageKey, error: errorMessage(error) };
  }
}

export async function handleGetPageOperationCount(pageKey: PageKey): Promise<PageStateResponse> {
  try {
    const operationCount = await getStore().countOperations(pageKey);
    return { ok: true, pageKey, operationCount };
  } catch (error) {
    return { ok: false, pageKey, error: errorMessage(error) };
  }
}

export async function handleSaveOperations(
  pageKey: PageKey,
  operations: EditorOperation[],
): Promise<StorageMutationResponse> {
  try {
    const result = await getStore().saveOperations(pageKey, operations);
    const response: StorageMutationResponse = {
      ok: true,
      saved: result.saved,
      skipped: result.skipped,
      operationCount: result.totalCount,
      trimmed: result.trimmed,
      capReached: result.capReached,
    };
    if (result.capReached) {
      response.error = `operation_cap_reached:trimmed_${String(result.trimmed)}`;
    }
    return response;
  } catch (error) {
    return { ok: false, error: formatStorageError(error) };
  }
}

export async function handleReplacePageOperations(
  pageKey: PageKey,
  operations: EditorOperation[],
): Promise<StorageMutationResponse> {
  try {
    const result = await getStore().replacePageOperations(pageKey, operations);
    return {
      ok: true,
      operationCount: result.totalCount,
      trimmed: result.trimmed,
      capReached: result.trimmed > 0,
    };
  } catch (error) {
    return { ok: false, error: formatStorageError(error) };
  }
}

export async function handleClearPage(pageKey: PageKey): Promise<StorageMutationResponse> {
  try {
    const removed = await getStore().clearPage(pageKey);
    return { ok: true, operationCount: 0, saved: removed };
  } catch (error) {
    return { ok: false, error: formatStorageError(error) };
  }
}

export async function handleExportData(): Promise<ExportDataResponse> {
  try {
    const payload = await getStore().exportAll();
    if (
      payload.sites.length === 0 &&
      payload.pages.length === 0 &&
      payload.operations.length === 0 &&
      payload.assets.length === 0
    ) {
      return {
        ok: false,
        error: "export_empty",
        userMessage: friendlyExportError("export_empty"),
      };
    }

    const serialized = serializeExportPayload(payload);
    if (!serialized.ok) {
      return serialized;
    }

    return {
      ok: true,
      json: serialized.json,
      byteLength: serialized.byteLength,
      ...(serialized.warning ? { warning: serialized.warning } : {}),
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      ok: false,
      error: message,
      userMessage: friendlyExportError(message),
    };
  }
}

export async function handleImportData(raw: unknown): Promise<ImportDataResponse> {
  try {
    const parsed =
      typeof raw === "string"
        ? parseImportJson(raw)
        : validateExportPayload(raw);

    if (!parsed.ok) {
      return {
        ok: false,
        error: parsed.error,
        userMessage: friendlyImportError(parsed.error),
      };
    }

    const imported = await getStore().importAll(parsed.payload);
    const usage = summarizeStorageUsage({
      operationCount: imported.operations,
      pageCount: imported.pages,
      assetCount: imported.assets,
      estimatedBytes: new TextEncoder().encode(JSON.stringify(parsed.payload)).length,
    });

    return {
      ok: true,
      imported,
      ...(usage.warning ? { warning: usage.warning } : {}),
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      ok: false,
      error: message,
      userMessage: friendlyImportError(message),
    };
  }
}

export async function handleGetStorageUsage(): Promise<StorageUsageResponse> {
  try {
    const usage = await getStore().estimateStorageBytes();
    const summary = summarizeStorageUsage(usage);
    return {
      ok: true,
      operationCount: summary.operationCount,
      pageCount: summary.pageCount,
      assetCount: summary.assetCount,
      estimatedBytes: summary.estimatedBytes,
      ...(summary.warning ? { warning: summary.warning } : {}),
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "storage_error";
}

function formatStorageError(error: unknown): string {
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return "indexeddb_quota_exceeded";
  }
  return errorMessage(error);
}
