import { OTF_MESSAGE } from "../shared/messages.js";
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
const extensionVersionEl = document.querySelector<HTMLElement>("#extension-version");
const buildModeEl = document.querySelector<HTMLElement>("#build-mode");
const agentModeEl = document.querySelector<HTMLElement>("#agent-mode");
const backendModeEl = document.querySelector<HTMLElement>("#backend-mode");
const schemaVersionEl = document.querySelector<HTMLElement>("#schema-version");

let currentSettings: ExtensionSettings = { ...DEFAULT_EXTENSION_SETTINGS };
let isSaving = false;

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

void loadSettings();
