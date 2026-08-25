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
    __OTF_ENVIRONMENT__?: import("./environment/environment-types.js").OTFEnvironment;
  }
}

window.OTF_RUNTIME_V2_ACTIVE = true;

const runtime = createEditorRuntime(document);
if (typeof __OTF_DIAGNOSTICS_ENABLED__ !== "undefined" && __OTF_DIAGNOSTICS_ENABLED__) {
  window.__OTF_ENVIRONMENT__ = runtime.environment;
  window.addEventListener("message", (event: MessageEvent) => {
    const payload = event.data as { channel?: unknown; id?: unknown; method?: unknown; args?: unknown } | null;
    if (event.source !== window || payload?.channel !== "otf-env") return;
    const id = payload.id;
    const method = typeof payload.method === "string" ? payload.method : "";
    const args = Array.isArray(payload.args) ? payload.args : [];
    const callable = (runtime.environment as unknown as Record<string, unknown>)[method];
    if (typeof callable !== "function") {
      window.postMessage({ channel: "otf-env-result", id, ok: false, error: { code: "UNSUPPORTED_OPERATION", message: `unknown_method:${method}` } }, "*");
      return;
    }
    void Promise.resolve((callable as (...params: unknown[]) => unknown).apply(runtime.environment, args)).then(
      (value) => {
        window.postMessage({ channel: "otf-env-result", id, ok: true, value }, "*");
      },
      (error: unknown) => {
        const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : "INTERNAL_ERROR";
        window.postMessage({
          channel: "otf-env-result",
          id,
          ok: false,
          error: { code, message: error instanceof Error ? error.message : "environment_failed" },
        }, "*");
      },
    );
  });
}
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
