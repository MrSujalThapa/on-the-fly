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

chrome.tabs.onRemoved.addListener((tabId) => {
  clearEditModeForTab(tabId);
});
