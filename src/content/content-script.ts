import {
  isEditModeChangedMessage,
  OTF_MESSAGE,
  parseEditModeResponse,
} from "../shared/messages.js";
import { EditorShell } from "./editor-shell.js";

const shell = new EditorShell();

async function requestEditModeDisable(): Promise<void> {
  const response = parseEditModeResponse(
    await chrome.runtime.sendMessage({
      type: OTF_MESSAGE.SET_EDIT_MODE,
      enabled: false,
    }),
  );

  if (response.ok && !response.enabled) {
    shell.unmount();
  }
}

function applyEditMode(enabled: boolean): void {
  if (enabled) {
    shell.mount(() => {
      void requestEditModeDisable();
    });
    return;
  }

  shell.unmount();
}

async function syncEditModeFromBackground(): Promise<void> {
  try {
    const response = parseEditModeResponse(
      await chrome.runtime.sendMessage({
        type: OTF_MESSAGE.GET_EDIT_MODE,
      }),
    );

    if (response.ok) {
      applyEditMode(response.enabled);
    }
  } catch {
    // Background may be unavailable during extension reload.
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isEditModeChangedMessage(message)) {
    return;
  }

  applyEditMode(message.enabled);
  sendResponse({ ok: true });
  return true;
});

void syncEditModeFromBackground();

export {};
