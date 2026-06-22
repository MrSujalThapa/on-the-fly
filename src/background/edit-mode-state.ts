const editModeByTabId = new Map<number, boolean>();

export function getEditModeForTab(tabId: number): boolean {
  return editModeByTabId.get(tabId) ?? false;
}

export function setEditModeForTab(tabId: number, enabled: boolean): void {
  editModeByTabId.set(tabId, enabled);
}

export function clearEditModeForTab(tabId: number): void {
  editModeByTabId.delete(tabId);
}

export function handleTabUpdatedForEditModeReset(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
): void {
  if (changeInfo.status === "loading" || changeInfo.url !== undefined) {
    clearEditModeForTab(tabId);
  }
}

if (typeof chrome !== "undefined") {
  chrome.tabs.onRemoved.addListener((tabId) => {
    clearEditModeForTab(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    handleTabUpdatedForEditModeReset(tabId, changeInfo);
  });
}
