import { isAgentEnabled } from "../shared/build-flags.js";
import {
  type EditModeStatus,
  OTF_MESSAGE,
  parseEditModeResponse,
} from "../shared/messages.js";
import { parseSettingsResponse } from "../shared/settings.js";
import { isRestrictedUrl } from "../shared/restricted-url.js";

const buildModeEl = document.querySelector<HTMLElement>("#build-mode");
const statusEl = document.querySelector<HTMLElement>("#edit-status");
const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-button");
const diagnosticsLine = document.querySelector<HTMLElement>("#diagnostics-line");
const openOptionsButton = document.querySelector<HTMLButtonElement>("#open-options");

let activeTabId: number | undefined;
let currentStatus: EditModeStatus = "inactive";
let isBusy = false;

function setBuildModeLabel(): void {
  if (!buildModeEl) {
    return;
  }

  buildModeEl.textContent = isAgentEnabled()
    ? "Local developer build · Agent enabled"
    : "Public build · Agent disabled";
}

function formatStatus(status: EditModeStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "unavailable":
      return "Unavailable";
    default:
      return "Inactive";
  }
}

function renderUi(): void {
  if (!statusEl || !toggleButton) {
    return;
  }

  statusEl.textContent = formatStatus(currentStatus);
  statusEl.dataset.status = currentStatus;

  if (currentStatus === "unavailable") {
    toggleButton.disabled = true;
    toggleButton.textContent = "Unavailable on this page";
    toggleButton.className = "toggle-button is-enable";
    return;
  }

  toggleButton.disabled = isBusy;
  if (currentStatus === "active") {
    toggleButton.textContent = "Disable On the Fly";
    toggleButton.className = "toggle-button is-disable";
    return;
  }

  toggleButton.textContent = "Enable On the Fly";
  toggleButton.className = "toggle-button is-enable";
}

function renderDiagnostics(settingsResponse: ReturnType<typeof parseSettingsResponse>): void {
  if (!diagnosticsLine) {
    return;
  }

  const diagnostics = settingsResponse.diagnostics;
  if (!settingsResponse.ok || !settingsResponse.settings || !diagnostics) {
    diagnosticsLine.textContent = "Settings unavailable";
    return;
  }

  const restoreLabel = settingsResponse.settings.restoreEditModeOnLoad ? "On" : "Off";
  const agentLabel = diagnostics.agentEnabled ? "Enabled" : "Disabled";

  diagnosticsLine.textContent = `v${diagnostics.extensionVersion} · Restore on load: ${restoreLabel} · Agent: ${agentLabel}`;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function loadSettingsSummary(): Promise<void> {
  try {
    const response = parseSettingsResponse(
      await chrome.runtime.sendMessage({ type: OTF_MESSAGE.GET_SETTINGS }),
    );
    renderDiagnostics(response);
  } catch {
    if (diagnosticsLine) {
      diagnosticsLine.textContent = "Settings unavailable";
    }
  }
}

async function refreshEditModeState(): Promise<void> {
  const tab = await getActiveTab();
  activeTabId = tab?.id;

  if (!tab?.id || isRestrictedUrl(tab.url)) {
    currentStatus = "unavailable";
    renderUi();
    return;
  }

  try {
    const response = parseEditModeResponse(
      await chrome.runtime.sendMessage({
        type: OTF_MESSAGE.GET_EDIT_MODE,
        tabId: tab.id,
      }),
    );

    currentStatus = response.status;
    renderUi();
  } catch {
    currentStatus = "unavailable";
    renderUi();
  }
}

async function setEditMode(enabled: boolean): Promise<void> {
  if (activeTabId === undefined || currentStatus === "unavailable") {
    return;
  }

  isBusy = true;
  renderUi();

  try {
    const response = parseEditModeResponse(
      await chrome.runtime.sendMessage({
        type: OTF_MESSAGE.SET_EDIT_MODE,
        enabled,
        tabId: activeTabId,
      }),
    );

    currentStatus = response.status;
  } catch {
    currentStatus = "unavailable";
  } finally {
    isBusy = false;
    renderUi();
  }
}

function wireToggleButton(): void {
  toggleButton?.addEventListener("click", () => {
    void setEditMode(currentStatus !== "active");
  });
}

function wireOptionsButton(): void {
  openOptionsButton?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });
}

setBuildModeLabel();
wireToggleButton();
wireOptionsButton();
void loadSettingsSummary();
void refreshEditModeState();
