import {
  isClearPageRequestMessage,
  isEditModeChangedMessage,
  OTF_MESSAGE,
  parseEditModeResponse,
} from "../shared/messages.js";
import { createEditSession, type EditSession } from "./edit-session.js";
import { EditorShell } from "./editor-shell.js";

const shell = new EditorShell();
let editSession: EditSession | null = null;

async function requestEditModeDisable(): Promise<void> {
  const response = parseEditModeResponse(
    await chrome.runtime.sendMessage({
      type: OTF_MESSAGE.SET_EDIT_MODE,
      enabled: false,
    }),
  );

  if (response.ok && !response.enabled) {
    editSession?.stop();
    editSession = null;
    shell.unmount();
  }
}

function applyEditMode(enabled: boolean): void {
  if (enabled) {
    const session = createEditSession({
      shell,
      root: document,
    });

    shell.mount({
      onDeactivate: () => {
        void requestEditModeDisable();
      },
      onEscape: () => session.handleEscape(),
    });
    session.start();
    editSession = session;
    return;
  }

  editSession?.stop();
  editSession = null;
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
  if (isEditModeChangedMessage(message)) {
    applyEditMode(message.enabled);
    sendResponse({ ok: true });
    return true;
  }

  if (isClearPageRequestMessage(message)) {
    if (!editSession) {
      sendResponse({ ok: false, error: "edit_mode_inactive" });
      return true;
    }

    void editSession.clearPage().then(
      () => {
        sendResponse({ ok: true });
      },
      () => {
        sendResponse({ ok: false, error: "clear_failed" });
      },
    );
    return true;
  }

  return undefined;
});

void syncEditModeFromBackground();

export {};
