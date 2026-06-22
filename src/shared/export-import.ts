import type { EditorOperation } from "../editor/operations.js";
import { validateOperation } from "../editor/validation/validate-operation.js";
import { isDangerousCssPath, isDangerousTagName } from "../editor/validation/dangerous-selectors.js";
import type {
  StoredCustomization,
  StoredOperation,
  StoredPage,
  StoredSite,
} from "./storage-records.js";
import {
  MAX_EXPORT_BYTES,
  MAX_IMPORT_BYTES,
  MAX_OPERATIONS_PER_PAGE,
  MAX_OPERATIONS_TOTAL,
  MAX_SINGLE_ASSET_BYTES,
  MAX_TOTAL_ASSETS_BYTES,
} from "./storage-limits.js";

export const OTF_EXPORT_SCHEMA_VERSION = 1;

export interface StoredAsset {
  id: string;
  pageKey: string;
  mimeType: string;
  byteLength: number;
  dataBase64: string;
  createdAt: number;
}

export interface OtfExportPayload {
  schemaVersion: number;
  exportedAt: number;
  dbName: string;
  sites: StoredSite[];
  pages: StoredPage[];
  customizations: StoredCustomization[];
  operations: StoredOperation[];
  assets: StoredAsset[];
}

export interface ExportDataResult {
  ok: true;
  payload: OtfExportPayload;
  json: string;
  byteLength: number;
  warning?: string;
}

export interface ExportDataFailure {
  ok: false;
  error: string;
  userMessage: string;
}

export type ExportDataResponse = ExportDataResult | ExportDataFailure;

export interface ImportDataResult {
  ok: true;
  imported: {
    sites: number;
    pages: number;
    customizations: number;
    operations: number;
    assets: number;
  };
  warning?: string;
}

export interface ImportDataFailure {
  ok: false;
  error: string;
  userMessage: string;
}

export type ImportDataResponse = ImportDataResult | ImportDataFailure;

export interface StorageUsageSummary {
  operationCount: number;
  pageCount: number;
  assetCount: number;
  estimatedBytes: number;
  warning?: string;
}

export function friendlyExportError(code: string): string {
  switch (code) {
    case "export_too_large":
      return "Your local data is too large to export safely. Try clearing unused pages first.";
    case "indexeddb_unavailable":
      return "Local storage is unavailable in this browser context.";
    case "export_empty":
      return "There is no On the Fly data to export yet.";
    default:
      return "Export failed. Please try again.";
  }
}

export function friendlyImportError(code: string): string {
  switch (code) {
    case "import_too_large":
      return "That backup file is too large to import.";
    case "invalid_json":
      return "The file is not valid JSON.";
    case "unsupported_schema":
      return "That backup uses an unsupported format version.";
    case "invalid_payload":
      return "The backup file is missing required data or contains invalid records.";
    case "dangerous_operation":
      return "The backup contains unsafe operations and was rejected.";
    case "operation_cap_exceeded":
      return `Import would exceed the ${String(MAX_OPERATIONS_TOTAL)} operation limit.`;
    case "page_operation_cap_exceeded":
      return `One or more pages exceed the ${String(MAX_OPERATIONS_PER_PAGE)} operation limit.`;
    case "asset_too_large":
      return `An asset exceeds the ${formatMegabytes(MAX_SINGLE_ASSET_BYTES)} per-image limit.`;
    case "assets_too_large":
      return `Total assets exceed the ${formatMegabytes(MAX_TOTAL_ASSETS_BYTES)} local limit.`;
    case "indexeddb_unavailable":
      return "Local storage is unavailable in this browser context.";
    default:
      return "Import failed. Check the file and try again.";
  }
}

export function summarizeStorageUsage(input: {
  operationCount: number;
  pageCount: number;
  assetCount: number;
  estimatedBytes: number;
}): StorageUsageSummary {
  const summary: StorageUsageSummary = { ...input };
  if (input.estimatedBytes >= STORAGE_SIZE_WARNING_BYTES) {
    summary.warning =
      "Local On the Fly storage is getting large. Consider exporting a backup or clearing old pages.";
  }
  return summary;
}

const STORAGE_SIZE_WARNING_BYTES = 15 * 1024 * 1024;

export function buildExportPayload(input: {
  dbName: string;
  sites: StoredSite[];
  pages: StoredPage[];
  customizations: StoredCustomization[];
  operations: StoredOperation[];
  assets: StoredAsset[];
  exportedAt?: number;
}): OtfExportPayload {
  return {
    schemaVersion: OTF_EXPORT_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? Date.now(),
    dbName: input.dbName,
    sites: input.sites,
    pages: input.pages,
    customizations: input.customizations,
    operations: input.operations,
    assets: input.assets,
  };
}

export function validateExportPayload(payload: unknown): {
  ok: true;
  payload: OtfExportPayload;
} | {
  ok: false;
  error: string;
} {
  if (!isRecord(payload)) {
    return { ok: false, error: "invalid_payload" };
  }

  const schemaVersion = payload.schemaVersion;
  if (schemaVersion !== OTF_EXPORT_SCHEMA_VERSION) {
    return { ok: false, error: "unsupported_schema" };
  }

  if (
    typeof payload.exportedAt !== "number" ||
    typeof payload.dbName !== "string" ||
    !Array.isArray(payload.sites) ||
    !Array.isArray(payload.pages) ||
    !Array.isArray(payload.customizations) ||
    !Array.isArray(payload.operations) ||
    !Array.isArray(payload.assets)
  ) {
    return { ok: false, error: "invalid_payload" };
  }

  return { ok: true, payload: payload as unknown as OtfExportPayload };
}

export function validateImportOperations(operations: EditorOperation[]): {
  ok: true;
} | {
  ok: false;
  error: string;
} {
  if (operations.length > MAX_OPERATIONS_TOTAL) {
    return { ok: false, error: "operation_cap_exceeded" };
  }

  const perPage = new Map<string, number>();
  for (const operation of operations) {
    const validation = validateOperation(operation);
    if (!validation.ok) {
      return { ok: false, error: "dangerous_operation" };
    }

    const signature = operation.target.signature;
    if (
      signature &&
      (isDangerousCssPath(signature.cssPath) || isDangerousTagName(signature.tagName))
    ) {
      return { ok: false, error: "dangerous_operation" };
    }

    const count = (perPage.get(operation.pageKey) ?? 0) + 1;
    if (count > MAX_OPERATIONS_PER_PAGE) {
      return { ok: false, error: "page_operation_cap_exceeded" };
    }
    perPage.set(operation.pageKey, count);
  }

  return { ok: true };
}

export function validateImportAssets(assets: StoredAsset[]): {
  ok: true;
} | {
  ok: false;
  error: string;
} {
  let totalBytes = 0;
  for (const asset of assets) {
    if (
      typeof asset.id !== "string" ||
      typeof asset.pageKey !== "string" ||
      typeof asset.mimeType !== "string" ||
      typeof asset.dataBase64 !== "string" ||
      typeof asset.byteLength !== "number" ||
      asset.byteLength < 0
    ) {
      return { ok: false, error: "invalid_payload" };
    }

    if (asset.byteLength > MAX_SINGLE_ASSET_BYTES) {
      return { ok: false, error: "asset_too_large" };
    }

    totalBytes += asset.byteLength;
    if (totalBytes > MAX_TOTAL_ASSETS_BYTES) {
      return { ok: false, error: "assets_too_large" };
    }
  }

  return { ok: true };
}

export function parseImportJson(raw: string): {
  ok: true;
  payload: OtfExportPayload;
} | {
  ok: false;
  error: string;
} {
  if (raw.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: "import_too_large" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, error: "invalid_json" };
  }

  return validateExportPayload(parsed);
}

export function serializeExportPayload(payload: OtfExportPayload): ExportDataResponse {
  const json = JSON.stringify(payload);
  const byteLength = new TextEncoder().encode(json).length;
  if (byteLength > MAX_EXPORT_BYTES) {
    return {
      ok: false,
      error: "export_too_large",
      userMessage: friendlyExportError("export_too_large"),
    };
  }

  const result: ExportDataResult = { ok: true, payload, json, byteLength };
  const warning = summarizeStorageUsage({
    operationCount: payload.operations.length,
    pageCount: payload.pages.length,
    assetCount: payload.assets.length,
    estimatedBytes: byteLength,
  }).warning;
  if (warning) {
    result.warning = warning;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatMegabytes(bytes: number): string {
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`;
}
