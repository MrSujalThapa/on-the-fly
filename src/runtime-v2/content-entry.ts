import {
  isClearPageRequestMessage,
  isEditModeChangedMessage,
  isGetUnsavedStateMessage,
} from "../shared/messages.js";
import { clearPageOperations } from "../content/storage-client.js";
import { computeDocumentPageKey, createPageIdentity } from "../content/page-identity.js";
import { createEditorRuntime } from "./create-editor-runtime.js";

declare global {
  interface Window {
    OTF_RUNTIME_V2_ACTIVE?: true;
  }
}

window.OTF_RUNTIME_V2_ACTIVE = true;

const runtime = createEditorRuntime(document);
const pageIdentity = createPageIdentity(document);

void runtime.replay();
pageIdentity.subscribe(() => {
  void runtime.replay();
});

function applyEditMode(enabled: boolean): void {
  if (enabled) {
    runtime.start();
    return;
  }
  runtime.stop();
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isEditModeChangedMessage(message)) {
    applyEditMode(message.enabled);
    sendResponse({ ok: true });
    return true;
  }

  if (isClearPageRequestMessage(message)) {
    void clearPageOperations(computeDocumentPageKey(document)).then(
      (cleared) => {
        if (!cleared) {
          sendResponse({ ok: false, error: "clear_persist_failed" });
          return;
        }
        runtime.stop();
        document.defaultView?.location.reload();
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
      hasUnsavedChanges: runtime.ledger.isDirty(),
      unsavedCount: runtime.ledger.activeOperations().length,
    });
    return true;
  }

  return undefined;
});

applyEditMode(false);

export {};
