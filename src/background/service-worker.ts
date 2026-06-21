import { registerBackgroundMessageHandler } from "./message-handler.js";
import { ensureDefaultSettings } from "./settings-storage.js";
import { buildFlags } from "../shared/build-flags.js";

void ensureDefaultSettings();
registerBackgroundMessageHandler();

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void ensureDefaultSettings();

  console.info("[On the Fly] background installed", {
    reason,
    publicAgentEnabled: buildFlags.publicAgentEnabled,
    publicBackendEnabled: buildFlags.publicBackendEnabled,
  });
});

export {};
