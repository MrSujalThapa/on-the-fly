import {
  createDefaultSettingsSnapshot,
  createSettingsDiagnostics,
  mergeExtensionSettings,
  normalizeSettingsSnapshot,
  type ExtensionSettingsUpdate,
  type SettingsDiagnostics,
  type SettingsResponse,
  type SettingsSnapshot,
  SETTINGS_STORAGE_KEY,
} from "../shared/settings.js";

async function readRawSnapshot(): Promise<SettingsSnapshot | undefined> {
  const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const stored: unknown = result[SETTINGS_STORAGE_KEY];
  if (stored === undefined) {
    return undefined;
  }

  return normalizeSettingsSnapshot(stored);
}

async function writeSnapshot(snapshot: SettingsSnapshot): Promise<void> {
  await chrome.storage.local.set({
    [SETTINGS_STORAGE_KEY]: snapshot,
  });
}

export async function ensureDefaultSettings(): Promise<void> {
  const existing = await readRawSnapshot();
  if (existing) {
    return;
  }

  await writeSnapshot(createDefaultSettingsSnapshot());
}

export async function loadSettingsSnapshot(): Promise<SettingsSnapshot> {
  const snapshot = await readRawSnapshot();
  return snapshot ?? createDefaultSettingsSnapshot();
}

export async function getSettingsResponse(): Promise<SettingsResponse> {
  const snapshot = await loadSettingsSnapshot();

  return {
    ok: true,
    settings: snapshot.settings,
    lastEditModeEnabled: false,
    diagnostics: createSettingsDiagnostics(),
  };
}

export async function updateExtensionSettings(
  update: ExtensionSettingsUpdate,
): Promise<SettingsResponse> {
  const snapshot = await loadSettingsSnapshot();
  const nextSettings = mergeExtensionSettings(snapshot.settings, update);

  const nextSnapshot: SettingsSnapshot = {
    settings: nextSettings,
    lastEditModeEnabled: false,
    updatedAt: Date.now(),
  };

  await writeSnapshot(nextSnapshot);

  return {
    ok: true,
    settings: nextSettings,
    lastEditModeEnabled: nextSnapshot.lastEditModeEnabled,
    diagnostics: createSettingsDiagnostics(),
  };
}

export async function setLastEditModeEnabled(enabled: boolean): Promise<void> {
  void enabled;
  const snapshot = await loadSettingsSnapshot();

  if (!snapshot.lastEditModeEnabled) {
    return;
  }

  await writeSnapshot({
    ...snapshot,
    lastEditModeEnabled: false,
    updatedAt: Date.now(),
  });
}

export function shouldRestoreEditModeForTab(): boolean {
  return false;
}

export function getSettingsDiagnostics(): SettingsDiagnostics {
  return createSettingsDiagnostics();
}
