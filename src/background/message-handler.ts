import {
  createEditModeChangedMessage,
  type EditModeResponse,
  type EditModeStatus,
  isGetEditModeMessage,
  isGetSettingsMessage,
  isSetEditModeMessage,
  isSetSettingsMessage,
  OTF_MESSAGE,
} from "../shared/messages.js";
import { isAgentEditRequestMessage } from "../shared/agent-messages.js";
import { buildFlags } from "../shared/build-flags.js";
import { proxyAgentEditRequest } from "./agent-proxy.js";
import {
  isClearPageMessage,
  isExportDataMessage,
  isGetPageOperationCountMessage,
  isGetStorageUsageMessage,
  isImportDataMessage,
  isLoadPageStateMessage,
  isReplacePageOperationsMessage,
  isSaveOperationsMessage,
} from "../shared/storage-messages.js";
import { isRestrictedUrl } from "../shared/restricted-url.js";
import { getEditModeForTab, setEditModeForTab } from "./edit-mode-state.js";
import {
  handleClearPage,
  handleExportData,
  handleGetPageOperationCount,
  handleGetStorageUsage,
  handleImportData,
  handleLoadPageState,
  handleReplacePageOperations,
  handleSaveOperations,
} from "./storage/storage-gateway.js";
import {
  getSettingsResponse,
  setLastEditModeEnabled,
  updateExtensionSettings,
} from "./settings-storage.js";

function toStatus(enabled: boolean): EditModeStatus {
  return enabled ? "active" : "inactive";
}

function unavailableResponse(error: string): EditModeResponse {
  return {
    ok: false,
    enabled: false,
    status: "unavailable",
    error,
  };
}

async function resolveTab(tabId: number | undefined): Promise<chrome.tabs.Tab | undefined> {
  if (tabId !== undefined) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return undefined;
    }
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function pushEditModeToTab(tabId: number, enabled: boolean): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, createEditModeChangedMessage(enabled));
  } catch {
    // Content scripts cannot run on restricted pages; state is still tracked in memory.
  }
}

async function handleGetEditMode(tabId: number | undefined): Promise<EditModeResponse> {
  const tab = await resolveTab(tabId);
  if (!tab?.id) {
    return unavailableResponse("no_active_tab");
  }

  if (isRestrictedUrl(tab.url)) {
    return unavailableResponse("restricted_page");
  }

  const enabled = getEditModeForTab(tab.id);

  return {
    ok: true,
    enabled,
    status: toStatus(enabled),
  };
}

async function handleSetEditMode(
  enabled: boolean,
  tabId: number | undefined,
): Promise<EditModeResponse> {
  const tab = await resolveTab(tabId);
  if (!tab?.id) {
    return unavailableResponse("no_active_tab");
  }

  if (isRestrictedUrl(tab.url)) {
    return unavailableResponse("restricted_page");
  }

  setEditModeForTab(tab.id, enabled);
  await setLastEditModeEnabled(enabled);
  await pushEditModeToTab(tab.id, enabled);

  return {
    ok: true,
    enabled,
    status: toStatus(enabled),
  };
}

export function registerBackgroundMessageHandler(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    void (async () => {
      if (isGetEditModeMessage(message)) {
        const tabId = message.tabId ?? sender.tab?.id;
        sendResponse(await handleGetEditMode(tabId));
        return;
      }

      if (isSetEditModeMessage(message)) {
        const tabId = message.tabId ?? sender.tab?.id;
        sendResponse(await handleSetEditMode(message.enabled, tabId));
        return;
      }

      if (isGetSettingsMessage(message)) {
        sendResponse(await getSettingsResponse());
        return;
      }

      if (isSetSettingsMessage(message)) {
        sendResponse(await updateExtensionSettings(message.settings));
        return;
      }

      if (isLoadPageStateMessage(message)) {
        sendResponse(await handleLoadPageState(message.pageKey));
        return;
      }

      if (isSaveOperationsMessage(message)) {
        sendResponse(await handleSaveOperations(message.pageKey, message.operations));
        return;
      }

      if (isReplacePageOperationsMessage(message)) {
        sendResponse(await handleReplacePageOperations(message.pageKey, message.operations));
        return;
      }

      if (isClearPageMessage(message)) {
        sendResponse(await handleClearPage(message.pageKey));
        return;
      }

      if (isGetPageOperationCountMessage(message)) {
        sendResponse(await handleGetPageOperationCount(message.pageKey));
        return;
      }

      if (isExportDataMessage(message)) {
        sendResponse(await handleExportData());
        return;
      }

      if (isImportDataMessage(message)) {
        sendResponse(await handleImportData(message.payload));
        return;
      }

      if (isGetStorageUsageMessage(message)) {
        sendResponse(await handleGetStorageUsage());
        return;
      }

      if (isAgentEditRequestMessage(message)) {
        sendResponse(
          await proxyAgentEditRequest(message.request, {
            flags: {
              publicAgentEnabled: buildFlags.publicAgentEnabled,
              localDevAgentEnabled: buildFlags.localDevAgentEnabled,
            },
            ...(buildFlags.localAgentServerUrl
              ? { configuredServerUrl: buildFlags.localAgentServerUrl }
              : {}),
          }),
        );
        return;
      }

      const messageType =
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        typeof message.type === "string"
          ? message.type
          : "invalid";

      sendResponse({
        ok: false,
        enabled: false,
        status: "unavailable",
        error: `unknown_message:${messageType}`,
      });
    })();

    return true;
  });
}

export { OTF_MESSAGE };
