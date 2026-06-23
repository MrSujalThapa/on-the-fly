import {
  isClearPageRequestMessage,
  isEditModeChangedMessage,
  isGetUnsavedStateMessage,
  OTF_MESSAGE,
  parseEditModeResponse,
} from "../shared/messages.js";
import { createEditSession, type EditSession } from "./edit-session.js";
import { EditorShell } from "./editor-shell.js";
import { PageCustomizationController } from "./page-customization-controller.js";

const shell = new EditorShell();
const pageCustomization = new PageCustomizationController(document);
let editSession: EditSession | null = null;

void pageCustomization.ensureReplayed();

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
    if (editSession) {
      return;
    }

    const session = createEditSession({
      shell,
      root: document,
      pageCustomization,
    });

    shell.mount({
      onDeactivate: () => {
        void requestEditModeDisable();
      },
      onEscape: () => session.handleEscape(),
    });
    void session.start();
    editSession = session;
    return;
  }

  editSession?.stop();
  editSession = null;
  shell.unmount();
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isEditModeChangedMessage(message)) {
    applyEditMode(message.enabled);
    sendResponse({ ok: true });
    return true;
  }

  if (isClearPageRequestMessage(message)) {
    void pageCustomization.clearPage().then(
      () => {
        editSession?.afterExternalClearPage();
        sendResponse({ ok: true });
      },
      () => {
        sendResponse({ ok: false, error: "clear_failed" });
      },
    );
    return true;
  }

  if (isGetUnsavedStateMessage(message)) {
    sendResponse({
      ok: true,
      hasUnsavedChanges: editSession?.hasUnsavedChanges() ?? false,
      unsavedCount: editSession?.getUnsavedChangeCount() ?? 0,
    });
    return true;
  }

  return undefined;
});

// Refresh/navigation always starts with edit mode off. Saved customizations
// replay above; only explicit popup toggles may activate the edit session.
applyEditMode(false);

export {};
