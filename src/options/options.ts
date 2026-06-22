import { OTF_MESSAGE } from "../shared/messages.js";
import {
  OTF_STORAGE_MESSAGE,
  type ExportDataResponse,
  type ImportDataResponse,
  type StorageUsageResponse,
} from "../shared/storage-messages.js";
import {
  DEFAULT_EXTENSION_SETTINGS,
  isToolbarPlacementValue,
  parseSettingsResponse,
  type ExtensionSettings,
} from "../shared/settings.js";

const restoreEditModeInput = document.querySelector<HTMLInputElement>("#restore-edit-mode");
const toolbarPlacementSelect = document.querySelector<HTMLSelectElement>("#toolbar-placement");
const interactShortcutInput = document.querySelector<HTMLInputElement>("#interact-shortcut");
const saveButton = document.querySelector<HTMLButtonElement>("#save-settings");
const saveStatus = document.querySelector<HTMLElement>("#save-status");
const exportButton = document.querySelector<HTMLButtonElement>("#export-data");
const importInput = document.querySelector<HTMLInputElement>("#import-data");
const dataStatus = document.querySelector<HTMLElement>("#data-status");
const storageUsageEl = document.querySelector<HTMLElement>("#storage-usage");
const extensionVersionEl = document.querySelector<HTMLElement>("#extension-version");
const buildModeEl = document.querySelector<HTMLElement>("#build-mode");
const agentModeEl = document.querySelector<HTMLElement>("#agent-mode");
const backendModeEl = document.querySelector<HTMLElement>("#backend-mode");
const schemaVersionEl = document.querySelector<HTMLElement>("#schema-version");

let currentSettings: ExtensionSettings = { ...DEFAULT_EXTENSION_SETTINGS };
let isSaving = false;

function setDataStatus(message: string, tone: "idle" | "success" | "error" = "idle"): void {
  if (!dataStatus) {
    return;
  }

  dataStatus.textContent = message;
  dataStatus.classList.remove("is-success", "is-error");

  if (tone === "success") {
    dataStatus.classList.add("is-success");
  }

  if (tone === "error") {
    dataStatus.classList.add("is-error");
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${String(Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadStorageUsage(): Promise<void> {
  if (!storageUsageEl) {
    return;
  }

  try {
    const response: StorageUsageResponse = await chrome.runtime.sendMessage({
      type: OTF_STORAGE_MESSAGE.GET_STORAGE_USAGE,
    });

    if (!response.ok || typeof response.estimatedBytes !== "number") {
      storageUsageEl.textContent = "Storage usage: unavailable";
      return;
    }

    const base = `Storage usage: ~${formatBytes(response.estimatedBytes)} (${String(response.operationCount ?? 0)} ops across ${String(response.pageCount ?? 0)} pages)`;
    storageUsageEl.textContent = response.warning ? `${base}. ${response.warning}` : base;
  } catch {
    storageUsageEl.textContent = "Storage usage: unavailable";
  }
}

async function exportLocalBackup(): Promise<void> {
  if (exportButton) {
    exportButton.disabled = true;
  }
  setDataStatus("Preparing export…");

  try {
    const response: ExportDataResponse = await chrome.runtime.sendMessage({
      type: OTF_STORAGE_MESSAGE.EXPORT_DATA,
    });

    if (!response.ok || typeof response.json !== "string") {
      setDataStatus(response.userMessage ?? "Export failed.", "error");
      return;
    }

    const blob = new Blob([response.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `on-the-fly-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);

    const message = response.warning
      ? `Backup exported. ${response.warning}`
      : "Backup exported.";
    setDataStatus(message, "success");
    void loadStorageUsage();
  } catch {
    setDataStatus("Export failed.", "error");
  } finally {
    if (exportButton) {
      exportButton.disabled = false;
    }
  }
}

async function importLocalBackup(file: File): Promise<void> {
  setDataStatus("Importing backup…");

  try {
    const raw = await file.text();
    const response: ImportDataResponse = await chrome.runtime.sendMessage({
      type: OTF_STORAGE_MESSAGE.IMPORT_DATA,
      payload: raw,
    });

    if (!response.ok) {
      setDataStatus(response.userMessage ?? "Import failed.", "error");
      return;
    }

    const imported = response.imported;
    const summary = imported
      ? `Imported ${String(imported.operations)} operations across ${String(imported.pages)} pages.`
      : "Import complete.";
    setDataStatus(response.warning ? `${summary} ${response.warning}` : summary, "success");
    void loadStorageUsage();
  } catch {
    setDataStatus("Import failed.", "error");
  } finally {
    if (importInput) {
      importInput.value = "";
    }
  }
}

function setSaveStatus(message: string, tone: "idle" | "success" | "error" = "idle"): void {
  if (!saveStatus) {
    return;
  }

  saveStatus.textContent = message;
  saveStatus.classList.remove("is-success", "is-error");

  if (tone === "success") {
    saveStatus.classList.add("is-success");
  }

  if (tone === "error") {
    saveStatus.classList.add("is-error");
  }
}

function applySettingsToForm(settings: ExtensionSettings): void {
  if (restoreEditModeInput) {
    restoreEditModeInput.checked = settings.restoreEditModeOnLoad;
  }

  if (toolbarPlacementSelect) {
    toolbarPlacementSelect.value = settings.toolbarPlacement;
  }

  if (interactShortcutInput) {
    interactShortcutInput.value = settings.interactModeShortcut;
  }
}

function readSettingsFromForm(): ExtensionSettings {
  return {
    ...currentSettings,
    restoreEditModeOnLoad: restoreEditModeInput?.checked ?? currentSettings.restoreEditModeOnLoad,
    toolbarPlacement: isToolbarPlacementValue(toolbarPlacementSelect?.value)
      ? toolbarPlacementSelect.value
      : currentSettings.toolbarPlacement,
    interactModeShortcut:
      interactShortcutInput?.value.trim() || DEFAULT_EXTENSION_SETTINGS.interactModeShortcut,
  };
}

function renderDiagnostics(response: ReturnType<typeof parseSettingsResponse>): void {
  const diagnostics = response.diagnostics;
  if (!diagnostics) {
    return;
  }

  if (extensionVersionEl) {
    extensionVersionEl.textContent = diagnostics.extensionVersion;
  }

  if (buildModeEl) {
    buildModeEl.textContent =
      diagnostics.buildMode === "local-developer" ? "Local developer" : "Public";
  }

  if (agentModeEl) {
    agentModeEl.textContent = diagnostics.agentEnabled ? "Enabled" : "Disabled";
  }

  if (backendModeEl) {
    backendModeEl.textContent = diagnostics.backendEnabled ? "Enabled" : "Disabled";
  }

  if (schemaVersionEl) {
    schemaVersionEl.textContent = String(diagnostics.schemaVersion);
  }
}

async function loadSettings(): Promise<void> {
  try {
    const response = parseSettingsResponse(
      await chrome.runtime.sendMessage({ type: OTF_MESSAGE.GET_SETTINGS }),
    );

    if (!response.ok || !response.settings) {
      setSaveStatus("Could not load settings.", "error");
      return;
    }

    currentSettings = response.settings;
    applySettingsToForm(currentSettings);
    renderDiagnostics(response);
    setSaveStatus("");
  } catch {
    setSaveStatus("Could not load settings.", "error");
  }
}

async function saveSettings(): Promise<void> {
  if (isSaving) {
    return;
  }

  isSaving = true;
  if (saveButton) {
    saveButton.disabled = true;
  }
  setSaveStatus("Saving…");

  const nextSettings = readSettingsFromForm();

  try {
    const response = parseSettingsResponse(
      await chrome.runtime.sendMessage({
        type: OTF_MESSAGE.SET_SETTINGS,
        settings: {
          restoreEditModeOnLoad: nextSettings.restoreEditModeOnLoad,
          toolbarPlacement: nextSettings.toolbarPlacement,
          interactModeShortcut: nextSettings.interactModeShortcut,
        },
      }),
    );

    if (!response.ok || !response.settings) {
      setSaveStatus(response.error ?? "Could not save settings.", "error");
      return;
    }

    currentSettings = response.settings;
    applySettingsToForm(currentSettings);
    renderDiagnostics(response);
    setSaveStatus("Settings saved.", "success");
  } catch {
    setSaveStatus("Could not save settings.", "error");
  } finally {
    isSaving = false;
    if (saveButton) {
      saveButton.disabled = false;
    }
  }
}

saveButton?.addEventListener("click", () => {
  void saveSettings();
});

exportButton?.addEventListener("click", () => {
  void exportLocalBackup();
});

importInput?.addEventListener("change", () => {
  const file = importInput.files?.[0];
  if (!file) {
    return;
  }
  void importLocalBackup(file);
});

void loadSettings();
void loadStorageUsage();
