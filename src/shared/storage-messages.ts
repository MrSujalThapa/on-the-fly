import type { PageKey } from "../editor/ids.js";
import type { EditorOperation } from "../editor/operations.js";

export const OTF_STORAGE_MESSAGE = {
  LOAD_PAGE_STATE: "OTF_LOAD_PAGE_STATE",
  SAVE_OPERATIONS: "OTF_SAVE_OPERATIONS",
  CLEAR_PAGE: "OTF_CLEAR_PAGE",
  EXPORT_DATA: "OTF_EXPORT_DATA",
  IMPORT_DATA: "OTF_IMPORT_DATA",
} as const;

export type OtfLoadPageStateMessage = {
  type: typeof OTF_STORAGE_MESSAGE.LOAD_PAGE_STATE;
  pageKey: PageKey;
};

export type OtfSaveOperationsMessage = {
  type: typeof OTF_STORAGE_MESSAGE.SAVE_OPERATIONS;
  pageKey: PageKey;
  operations: EditorOperation[];
};

export type OtfClearPageMessage = {
  type: typeof OTF_STORAGE_MESSAGE.CLEAR_PAGE;
  pageKey: PageKey;
};

export type OtfExportDataMessage = {
  type: typeof OTF_STORAGE_MESSAGE.EXPORT_DATA;
};

export type OtfImportDataMessage = {
  type: typeof OTF_STORAGE_MESSAGE.IMPORT_DATA;
  payload: unknown;
};

export type StorageRequestMessage =
  | OtfLoadPageStateMessage
  | OtfSaveOperationsMessage
  | OtfClearPageMessage
  | OtfExportDataMessage
  | OtfImportDataMessage;

export interface PageStateResponse {
  ok: boolean;
  pageKey?: PageKey;
  operations?: EditorOperation[];
  error?: string;
}

export interface StorageMutationResponse {
  ok: boolean;
  error?: string;
}

export function isLoadPageStateMessage(value: unknown): value is OtfLoadPageStateMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === OTF_STORAGE_MESSAGE.LOAD_PAGE_STATE &&
    "pageKey" in value &&
    typeof value.pageKey === "string"
  );
}

export function isSaveOperationsMessage(value: unknown): value is OtfSaveOperationsMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === OTF_STORAGE_MESSAGE.SAVE_OPERATIONS &&
    "pageKey" in value &&
    typeof value.pageKey === "string" &&
    "operations" in value &&
    Array.isArray(value.operations)
  );
}

export function isClearPageMessage(value: unknown): value is OtfClearPageMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === OTF_STORAGE_MESSAGE.CLEAR_PAGE &&
    "pageKey" in value &&
    typeof value.pageKey === "string"
  );
}
