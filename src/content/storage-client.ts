import type { EditorOperation } from "../editor/operations.js";
import type { PageKey } from "../editor/ids.js";
import {
  OTF_STORAGE_MESSAGE,
  type ExportDataResponse,
  type ImportDataResponse,
  type PageStateResponse,
  type StorageMutationResponse,
  type StorageUsageResponse,
} from "../shared/storage-messages.js";

interface RuntimeMessenger {
  sendMessage: (message: unknown) => Promise<unknown>;
}

export interface SavePageOperationsResult {
  ok: boolean;
  operationCount?: number;
  saved?: number;
  skipped?: number;
  trimmed?: number;
  capReached?: boolean;
  error?: string;
}

/**
 * Returns the extension runtime messenger when available. In non-extension
 * contexts (unit tests, page contexts without the API) this returns null so
 * persistence degrades to a no-op instead of throwing.
 */
function getRuntime(): RuntimeMessenger | null {
  const globalChrome = (globalThis as { chrome?: { runtime?: RuntimeMessenger } }).chrome;
  const runtime = globalChrome?.runtime;
  if (!runtime || typeof runtime.sendMessage !== "function") {
    return null;
  }
  return runtime;
}

export async function loadPageOperations(pageKey: PageKey): Promise<EditorOperation[]> {
  const runtime = getRuntime();
  if (!runtime) {
    return [];
  }

  try {
    const response = (await runtime.sendMessage({
      type: OTF_STORAGE_MESSAGE.LOAD_PAGE_STATE,
      pageKey,
    })) as PageStateResponse | undefined;

    if (response?.ok && Array.isArray(response.operations)) {
      return response.operations;
    }
  } catch {
    // Background may be unavailable; treat as no saved state.
  }

  return [];
}

export async function getPageOperationCount(pageKey: PageKey): Promise<number | null> {
  const runtime = getRuntime();
  if (!runtime) {
    return null;
  }

  try {
    const response = (await runtime.sendMessage({
      type: OTF_STORAGE_MESSAGE.GET_PAGE_OPERATION_COUNT,
      pageKey,
    })) as PageStateResponse | undefined;

    if (response?.ok && typeof response.operationCount === "number") {
      return response.operationCount;
    }
  } catch {
    return null;
  }

  return null;
}

export async function savePageOperations(
  pageKey: PageKey,
  operations: EditorOperation[],
): Promise<SavePageOperationsResult> {
  const runtime = getRuntime();
  if (!runtime || operations.length === 0) {
    return { ok: false, error: "no_runtime_or_empty_batch" };
  }

  try {
    const response = (await runtime.sendMessage({
      type: OTF_STORAGE_MESSAGE.SAVE_OPERATIONS,
      pageKey,
      operations,
    })) as StorageMutationResponse | undefined;

    if (!response) {
      return { ok: false, error: "empty_response" };
    }

    const result: SavePageOperationsResult = { ok: response.ok };
    if (response.operationCount !== undefined) {
      result.operationCount = response.operationCount;
    }
    if (response.saved !== undefined) {
      result.saved = response.saved;
    }
    if (response.skipped !== undefined) {
      result.skipped = response.skipped;
    }
    if (response.trimmed !== undefined) {
      result.trimmed = response.trimmed;
    }
    if (response.capReached !== undefined) {
      result.capReached = response.capReached;
    }
    if (response.error !== undefined) {
      result.error = response.error;
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "save_failed",
    };
  }
}

export async function replacePageOperations(
  pageKey: PageKey,
  operations: EditorOperation[],
): Promise<SavePageOperationsResult> {
  const runtime = getRuntime();
  if (!runtime) {
    return { ok: false, error: "no_runtime" };
  }

  try {
    const response = (await runtime.sendMessage({
      type: OTF_STORAGE_MESSAGE.REPLACE_PAGE_OPERATIONS,
      pageKey,
      operations,
    })) as StorageMutationResponse | undefined;

    if (!response) {
      return { ok: false, error: "empty_response" };
    }

    return {
      ok: response.ok,
      ...(response.operationCount !== undefined ? { operationCount: response.operationCount } : {}),
      ...(response.trimmed !== undefined ? { trimmed: response.trimmed } : {}),
      ...(response.capReached !== undefined ? { capReached: response.capReached } : {}),
      ...(response.error !== undefined ? { error: response.error } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "replace_failed",
    };
  }
}

export async function clearPageOperations(pageKey: PageKey): Promise<boolean> {
  const runtime = getRuntime();
  if (!runtime) {
    // No extension runtime means nothing was ever persisted via the background
    // store, so there is nothing to delete: treat the clear as succeeded.
    return true;
  }

  try {
    const response = (await runtime.sendMessage({
      type: OTF_STORAGE_MESSAGE.CLEAR_PAGE,
      pageKey,
    })) as StorageMutationResponse | undefined;
    return response?.ok === true;
  } catch {
    return false;
  }
}

export async function exportLocalData(): Promise<ExportDataResponse> {
  const runtime = getRuntime();
  if (!runtime) {
    return { ok: false, error: "no_runtime", userMessage: "Extension runtime unavailable." };
  }

  try {
    return (await runtime.sendMessage({
      type: OTF_STORAGE_MESSAGE.EXPORT_DATA,
    })) as ExportDataResponse;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "export_failed",
      userMessage: "Export failed. Please try again.",
    };
  }
}

export async function importLocalData(payload: unknown): Promise<ImportDataResponse> {
  const runtime = getRuntime();
  if (!runtime) {
    return { ok: false, error: "no_runtime", userMessage: "Extension runtime unavailable." };
  }

  try {
    return (await runtime.sendMessage({
      type: OTF_STORAGE_MESSAGE.IMPORT_DATA,
      payload,
    })) as ImportDataResponse;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "import_failed",
      userMessage: "Import failed. Please try again.",
    };
  }
}

export async function getStorageUsage(): Promise<StorageUsageResponse> {
  const runtime = getRuntime();
  if (!runtime) {
    return { ok: false, error: "no_runtime" };
  }

  try {
    return (await runtime.sendMessage({
      type: OTF_STORAGE_MESSAGE.GET_STORAGE_USAGE,
    })) as StorageUsageResponse;
  } catch {
    return { ok: false, error: "usage_failed" };
  }
}
