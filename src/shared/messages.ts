import type { ExtensionSettingsUpdate } from "./settings.js";

export type {
  AgentEditRequest,
  AgentEditResponse,
  AgentOperationValidationResult,
  AgentPreviewState,
} from "./agent-contracts.js";

export {
  OTF_STORAGE_MESSAGE,
  type OtfClearPageMessage,
  type OtfExportDataMessage,
  type OtfGetPageOperationCountMessage,
  type OtfGetStorageUsageMessage,
  type OtfImportDataMessage,
  type OtfLoadPageStateMessage,
  type OtfSaveOperationsMessage,
  type ExportDataResponse,
  type ImportDataResponse,
  type PageStateResponse,
  type StorageMutationResponse,
  type StorageRequestMessage,
  type StorageUsageResponse,
  isClearPageMessage,
  isExportDataMessage,
  isGetPageOperationCountMessage,
  isGetStorageUsageMessage,
  isImportDataMessage,
  isLoadPageStateMessage,
  isSaveOperationsMessage,
} from "./storage-messages.js";

export const OTF_MESSAGE = {
  SET_EDIT_MODE: "OTF_SET_EDIT_MODE",
  GET_EDIT_MODE: "OTF_GET_EDIT_MODE",
  EDIT_MODE_CHANGED: "OTF_EDIT_MODE_CHANGED",
  GET_SETTINGS: "OTF_GET_SETTINGS",
  SET_SETTINGS: "OTF_SET_SETTINGS",
  CLEAR_PAGE_REQUEST: "OTF_CLEAR_PAGE_REQUEST",
  GET_UNSAVED_STATE: "OTF_GET_UNSAVED_STATE",
} as const;

export type EditModeStatus = "inactive" | "active" | "unavailable";

export type OtfSetEditModeMessage = {
  type: typeof OTF_MESSAGE.SET_EDIT_MODE;
  enabled: boolean;
  tabId?: number;
};

export type OtfGetEditModeMessage = {
  type: typeof OTF_MESSAGE.GET_EDIT_MODE;
  tabId?: number;
};

export type OtfEditModeChangedMessage = {
  type: typeof OTF_MESSAGE.EDIT_MODE_CHANGED;
  enabled: boolean;
};

export type OtfClearPageRequestMessage = {
  type: typeof OTF_MESSAGE.CLEAR_PAGE_REQUEST;
};

export type OtfGetUnsavedStateMessage = {
  type: typeof OTF_MESSAGE.GET_UNSAVED_STATE;
};

export interface UnsavedStateResponse {
  ok: boolean;
  hasUnsavedChanges: boolean;
  unsavedCount: number;
}

export type OtfGetSettingsMessage = {
  type: typeof OTF_MESSAGE.GET_SETTINGS;
};

export type OtfSetSettingsMessage = {
  type: typeof OTF_MESSAGE.SET_SETTINGS;
  settings: ExtensionSettingsUpdate;
};

export type ExtensionRequestMessage =
  | OtfSetEditModeMessage
  | OtfGetEditModeMessage
  | OtfGetSettingsMessage
  | OtfSetSettingsMessage;

export type ExtensionPushMessage = OtfEditModeChangedMessage | OtfClearPageRequestMessage;

export interface EditModeResponse {
  ok: boolean;
  enabled: boolean;
  status: EditModeStatus;
  error?: string;
}

export function isSetEditModeMessage(value: unknown): value is OtfSetEditModeMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === OTF_MESSAGE.SET_EDIT_MODE &&
    "enabled" in value &&
    typeof value.enabled === "boolean"
  );
}

export function isGetEditModeMessage(value: unknown): value is OtfGetEditModeMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === OTF_MESSAGE.GET_EDIT_MODE
  );
}

export function isEditModeChangedMessage(value: unknown): value is OtfEditModeChangedMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === OTF_MESSAGE.EDIT_MODE_CHANGED &&
    "enabled" in value &&
    typeof value.enabled === "boolean"
  );
}

export function isGetSettingsMessage(value: unknown): value is OtfGetSettingsMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === OTF_MESSAGE.GET_SETTINGS
  );
}

export function isSetSettingsMessage(value: unknown): value is OtfSetSettingsMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === OTF_MESSAGE.SET_SETTINGS &&
    "settings" in value &&
    typeof value.settings === "object" &&
    value.settings !== null
  );
}

export function isClearPageRequestMessage(value: unknown): value is OtfClearPageRequestMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === OTF_MESSAGE.CLEAR_PAGE_REQUEST
  );
}

export function isGetUnsavedStateMessage(value: unknown): value is OtfGetUnsavedStateMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === OTF_MESSAGE.GET_UNSAVED_STATE
  );
}

export function parseUnsavedStateResponse(value: unknown): UnsavedStateResponse {
  if (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "hasUnsavedChanges" in value &&
    typeof value.hasUnsavedChanges === "boolean" &&
    "unsavedCount" in value &&
    typeof value.unsavedCount === "number"
  ) {
    return {
      ok: value.ok,
      hasUnsavedChanges: value.hasUnsavedChanges,
      unsavedCount: value.unsavedCount,
    };
  }

  return { ok: false, hasUnsavedChanges: false, unsavedCount: 0 };
}

export function createEditModeChangedMessage(enabled: boolean): OtfEditModeChangedMessage {
  return { type: OTF_MESSAGE.EDIT_MODE_CHANGED, enabled };
}

export function parseEditModeResponse(value: unknown): EditModeResponse {
  if (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof value.ok === "boolean" &&
    "enabled" in value &&
    typeof value.enabled === "boolean" &&
    "status" in value &&
    (value.status === "inactive" || value.status === "active" || value.status === "unavailable")
  ) {
    const response: EditModeResponse = {
      ok: value.ok,
      enabled: value.enabled,
      status: value.status,
    };

    if ("error" in value && typeof value.error === "string") {
      response.error = value.error;
    }

    return response;
  }

  return {
    ok: false,
    enabled: false,
    status: "unavailable",
    error: "invalid_response",
  };
}
