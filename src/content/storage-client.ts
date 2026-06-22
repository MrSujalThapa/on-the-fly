import type { EditorOperation } from "../editor/operations.js";
import type { PageKey } from "../editor/ids.js";
import {
  OTF_STORAGE_MESSAGE,
  type PageStateResponse,
  type StorageMutationResponse,
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

export async function clearPageOperations(pageKey: PageKey): Promise<boolean> {
  const runtime = getRuntime();
  if (!runtime) {
    return false;
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
