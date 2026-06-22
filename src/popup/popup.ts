import { isAgentEnabled } from "../shared/build-flags.js";
import {
  type EditModeStatus,
  OTF_MESSAGE,
  OTF_STORAGE_MESSAGE,
  parseEditModeResponse,
  type PageStateResponse,
} from "../shared/messages.js";
import { parseSettingsResponse } from "../shared/settings.js";
import { isRestrictedUrl } from "../shared/restricted-url.js";
import {
  formatAgentStatus,
  formatPopupDiagnostics,
} from "./popup-view.js";

const buildModeEl = document.querySelector<HTMLElement>("#build-mode");
const statusEl = document.querySelector<HTMLElement>("#edit-status");
const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-button");
const clearPageButton = document.querySelector<HTMLButtonElement>("#clear-page");
const diagnosticsLine = document.querySelector<HTMLElement>("#diagnostics-line");
const openOptionsButton = document.querySelector<HTMLButtonElement>("#open-options");

let activeTabId: number | undefined;
let currentStatus: EditModeStatus = "inactive";
let isBusy = false;
let pageOperationCount: number | null = null;

function setBuildModeLabel(): void {
  if (!buildModeEl) {
    return;
  }

  buildModeEl.textContent = formatAgentStatus(isAgentEnabled());
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

  if (clearPageButton) {
    clearPageButton.disabled = currentStatus === "unavailable" || isBusy || pageOperationCount === 0;
  }

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

function derivePageKeyFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

async function loadPageOperationCount(): Promise<number | null> {
  const tab = await getActiveTab();
  const pageKey = derivePageKeyFromUrl(tab?.url);
  if (!pageKey) {
    return null;
  }

  try {
    const response: PageStateResponse = await chrome.runtime.sendMessage({
      type: OTF_STORAGE_MESSAGE.GET_PAGE_OPERATION_COUNT,
      pageKey,
    });

    if (response.ok && typeof response.operationCount === "number") {
      return response.operationCount;
    }
  } catch {
    return null;
  }

  return null;
}

function renderDiagnostics(settingsResponse: ReturnType<typeof parseSettingsResponse>): void {
  if (!diagnosticsLine) {
    return;
  }

  const diagnostics = settingsResponse.diagnostics;
  if (!settingsResponse.ok || !settingsResponse.settings || !diagnostics) {
    diagnosticsLine.textContent = formatPopupDiagnostics({
      operationCount: pageOperationCount,
      agentEnabled: false,
    });
    return;
  }

  diagnosticsLine.textContent = formatPopupDiagnostics({
    operationCount: pageOperationCount,
    agentEnabled: diagnostics.agentEnabled,
  });
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
    pageOperationCount = await loadPageOperationCount();
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
    pageOperationCount = await loadPageOperationCount();
    renderUi();
    void loadSettingsSummary();
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

async function clearCurrentPage(): Promise<void> {
  if (activeTabId === undefined || currentStatus === "unavailable") {
    return;
  }

  isBusy = true;
  renderUi();

  try {
    await chrome.tabs.sendMessage(activeTabId, {
      type: OTF_MESSAGE.CLEAR_PAGE_REQUEST,
    });
    pageOperationCount = await loadPageOperationCount();
    void loadSettingsSummary();
  } catch {
    // Content script may be unavailable; storage stays intact.
  } finally {
    isBusy = false;
    renderUi();
  }
}

function wireClearPageButton(): void {
  clearPageButton?.addEventListener("click", () => {
    void clearCurrentPage();
  });
}

setBuildModeLabel();
wireToggleButton();
wireClearPageButton();
wireOptionsButton();
void loadSettingsSummary();
void refreshEditModeState();
