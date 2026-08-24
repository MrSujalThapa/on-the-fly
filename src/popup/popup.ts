import { isLocalAgentAvailable } from "../shared/build-flags.js";
import { pageKeyFromUrl } from "../content/page-identity.js";
import {
  type EditModeStatus,
  OTF_MESSAGE,
  OTF_STORAGE_MESSAGE,
  parseEditModeResponse,
  parseUnsavedStateResponse,
  type PageStateResponse,
} from "../shared/messages.js";
import { parseSettingsResponse } from "../shared/settings.js";
import { isRestrictedUrl } from "../shared/restricted-url.js";
import {
  formatAgentStatus,
  formatSavedOpsDisplayCount,
  formatUnsavedStatus,
} from "./popup-view.js";

const popupRoot = document.querySelector<HTMLElement>("#popup-root");
const buildModeEl = document.querySelector<HTMLElement>("#build-mode");
const statusEl = document.querySelector<HTMLElement>("#edit-status");
const toggleButton = document.querySelector<HTMLButtonElement>("#toggle-button");
const toggleButtonLabel = toggleButton?.querySelector("span");
const clearPageButton = document.querySelector<HTMLButtonElement>("#clear-page");
const savedOpsCountEl = document.querySelector<HTMLElement>("#saved-ops-count");
const unsavedStatusEl = document.querySelector<HTMLElement>("#unsaved-status");
const agentStatusEl = document.querySelector<HTMLElement>("#agent-status");
const openOptionsButton = document.querySelector<HTMLButtonElement>("#open-options");

let activeTabId: number | undefined;
let currentStatus: EditModeStatus = "inactive";
let isBusy = false;
let pageOperationCount: number | null = null;
let unsavedChangeCount: number | null = null;

function setBuildModeLabel(): void {
  if (!buildModeEl) {
    return;
  }

  buildModeEl.textContent = formatAgentStatus(isLocalAgentAvailable());
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

function setToggleButtonLabel(label: string): void {
  if (toggleButtonLabel) {
    toggleButtonLabel.textContent = label;
    return;
  }

  if (toggleButton) {
    toggleButton.textContent = label;
  }
}

function renderUi(): void {
  if (!statusEl || !toggleButton) {
    return;
  }

  if (popupRoot) {
    popupRoot.dataset.state = currentStatus;
  }

  statusEl.textContent = formatStatus(currentStatus);

  if (savedOpsCountEl) {
    savedOpsCountEl.textContent = formatSavedOpsDisplayCount(pageOperationCount);
  }

  if (unsavedStatusEl) {
    const unsavedLabel = formatUnsavedStatus(unsavedChangeCount, currentStatus === "active");
    unsavedStatusEl.textContent = unsavedLabel;
    unsavedStatusEl.hidden = unsavedLabel.length === 0;
  }

  if (clearPageButton) {
    clearPageButton.disabled = currentStatus === "unavailable" || isBusy || pageOperationCount === 0;
  }

  if (currentStatus === "unavailable") {
    toggleButton.disabled = true;
    setToggleButtonLabel("Unavailable on this page");
    toggleButton.className = "primary is-enable";
    return;
  }

  toggleButton.disabled = isBusy;
  if (currentStatus === "active") {
    setToggleButtonLabel("Disable editor");
    toggleButton.className = "primary is-disable";
    return;
  }

  setToggleButtonLabel("Enable editor");
  toggleButton.className = "primary is-enable";
}

async function loadPageOperationCount(): Promise<number | null> {
  const tab = await getActiveTab();
  const pageKey = pageKeyFromUrl(tab?.url ?? "");
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

async function loadUnsavedState(): Promise<number | null> {
  if (activeTabId === undefined || currentStatus !== "active") {
    return null;
  }

  try {
    const response = parseUnsavedStateResponse(
      await chrome.tabs.sendMessage(activeTabId, {
        type: OTF_MESSAGE.GET_UNSAVED_STATE,
      }),
    );

    if (response.ok) {
      return response.unsavedCount;
    }
  } catch {
    return null;
  }

  return null;
}

function renderDiagnostics(settingsResponse: ReturnType<typeof parseSettingsResponse>): void {
  if (!agentStatusEl) {
    return;
  }

  const diagnostics = settingsResponse.diagnostics;
  if (!settingsResponse.ok || !settingsResponse.settings || !diagnostics) {
    agentStatusEl.textContent = formatAgentStatus(false);
    return;
  }

  agentStatusEl.textContent = formatAgentStatus(diagnostics.agentEnabled);
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
    renderUi();
  } catch {
    if (agentStatusEl) {
      agentStatusEl.textContent = "Settings unavailable";
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
    unsavedChangeCount = await loadUnsavedState();
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
    pageOperationCount = await loadPageOperationCount();
    unsavedChangeCount = await loadUnsavedState();
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
    const response: unknown = await chrome.tabs.sendMessage(activeTabId, {
      type: OTF_MESSAGE.CLEAR_PAGE_REQUEST,
    });
    if (
      typeof response !== "object" ||
      response === null ||
      !("ok" in response) ||
      response.ok !== true
    ) {
      return;
    }
    pageOperationCount = await loadPageOperationCount();
    unsavedChangeCount = 0;
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
