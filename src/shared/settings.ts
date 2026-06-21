import { buildFlags, isAgentEnabled, isBackendEnabled } from "./build-flags.js";

export const SETTINGS_SCHEMA_VERSION = 1 as const;
export const SETTINGS_STORAGE_KEY = "otf_settings_v1";

export const TOOLBAR_PLACEMENTS = ["auto", "top", "bottom", "near-selection"] as const;
export type ToolbarPlacement = (typeof TOOLBAR_PLACEMENTS)[number];

export interface ExtensionSettings {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  restoreEditModeOnLoad: boolean;
  toolbarPlacement: ToolbarPlacement;
  interactModeShortcut: string;
}

export interface SettingsSnapshot {
  settings: ExtensionSettings;
  lastEditModeEnabled: boolean;
  updatedAt: number;
}

export type ExtensionSettingsUpdate = Partial<
  Pick<ExtensionSettings, "restoreEditModeOnLoad" | "toolbarPlacement" | "interactModeShortcut">
>;

export interface SettingsDiagnostics {
  extensionVersion: string;
  buildMode: "public" | "local-developer";
  agentEnabled: boolean;
  backendEnabled: boolean;
  schemaVersion: number;
}

export interface SettingsResponse {
  ok: boolean;
  settings?: ExtensionSettings;
  lastEditModeEnabled?: boolean;
  diagnostics?: SettingsDiagnostics;
  error?: string;
}

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  restoreEditModeOnLoad: false,
  toolbarPlacement: "auto",
  interactModeShortcut: "Alt+Shift+I",
};

export function createDefaultSettingsSnapshot(): SettingsSnapshot {
  return {
    settings: { ...DEFAULT_EXTENSION_SETTINGS },
    lastEditModeEnabled: false,
    updatedAt: Date.now(),
  };
}

export function createSettingsDiagnostics(): SettingsDiagnostics {
  return {
    extensionVersion: chrome.runtime.getManifest().version,
    buildMode: isAgentEnabled() ? "local-developer" : "public",
    agentEnabled: buildFlags.publicAgentEnabled,
    backendEnabled: isBackendEnabled(),
    schemaVersion: SETTINGS_SCHEMA_VERSION,
  };
}

function isToolbarPlacement(value: unknown): value is ToolbarPlacement {
  return typeof value === "string" && (TOOLBAR_PLACEMENTS as readonly string[]).includes(value);
}

export function isToolbarPlacementValue(value: unknown): value is ToolbarPlacement {
  return isToolbarPlacement(value);
}

function normalizeShortcut(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_EXTENSION_SETTINGS.interactModeShortcut;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 48) {
    return DEFAULT_EXTENSION_SETTINGS.interactModeShortcut;
  }

  return trimmed;
}

export function normalizeExtensionSettings(value: unknown): ExtensionSettings {
  const candidate =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    restoreEditModeOnLoad:
      typeof candidate.restoreEditModeOnLoad === "boolean"
        ? candidate.restoreEditModeOnLoad
        : DEFAULT_EXTENSION_SETTINGS.restoreEditModeOnLoad,
    toolbarPlacement: isToolbarPlacement(candidate.toolbarPlacement)
      ? candidate.toolbarPlacement
      : DEFAULT_EXTENSION_SETTINGS.toolbarPlacement,
    interactModeShortcut: normalizeShortcut(candidate.interactModeShortcut),
  };
}

export function normalizeSettingsSnapshot(value: unknown): SettingsSnapshot {
  if (typeof value !== "object" || value === null) {
    return createDefaultSettingsSnapshot();
  }

  const candidate = value as Record<string, unknown>;

  return {
    settings: normalizeExtensionSettings(candidate.settings),
    lastEditModeEnabled:
      typeof candidate.lastEditModeEnabled === "boolean" ? candidate.lastEditModeEnabled : false,
    updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
  };
}

export function mergeExtensionSettings(
  current: ExtensionSettings,
  update: ExtensionSettingsUpdate,
): ExtensionSettings {
  const next: ExtensionSettings = { ...current };

  if (typeof update.restoreEditModeOnLoad === "boolean") {
    next.restoreEditModeOnLoad = update.restoreEditModeOnLoad;
  }

  if (update.toolbarPlacement !== undefined) {
    next.toolbarPlacement = isToolbarPlacement(update.toolbarPlacement)
      ? update.toolbarPlacement
      : current.toolbarPlacement;
  }

  if (update.interactModeShortcut !== undefined) {
    next.interactModeShortcut = normalizeShortcut(update.interactModeShortcut);
  }

  return next;
}

export function parseSettingsResponse(value: unknown): SettingsResponse {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return { ok: false, error: "invalid_response" };
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.ok !== "boolean") {
    return { ok: false, error: "invalid_response" };
  }

  if (!candidate.ok) {
    const response: SettingsResponse = { ok: false };
    if (typeof candidate.error === "string") {
      response.error = candidate.error;
    }
    return response;
  }

  const response: SettingsResponse = { ok: true };

  if ("settings" in candidate) {
    response.settings = normalizeExtensionSettings(candidate.settings);
  }

  if (typeof candidate.lastEditModeEnabled === "boolean") {
    response.lastEditModeEnabled = candidate.lastEditModeEnabled;
  }

  if (typeof candidate.diagnostics === "object" && candidate.diagnostics !== null) {
    const diagnostics = candidate.diagnostics as Record<string, unknown>;
    response.diagnostics = {
      extensionVersion:
        typeof diagnostics.extensionVersion === "string"
          ? diagnostics.extensionVersion
          : chrome.runtime.getManifest().version,
      buildMode: diagnostics.buildMode === "local-developer" ? "local-developer" : "public",
      agentEnabled: diagnostics.agentEnabled === true,
      backendEnabled: diagnostics.backendEnabled === true,
      schemaVersion:
        typeof diagnostics.schemaVersion === "number"
          ? diagnostics.schemaVersion
          : SETTINGS_SCHEMA_VERSION,
    };
  }

  return response;
}
