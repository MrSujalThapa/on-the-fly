import { buildFlags } from "../shared/build-flags.js";

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.info("[On the Fly] background installed", {
    reason,
    publicAgentEnabled: buildFlags.publicAgentEnabled,
    publicBackendEnabled: buildFlags.publicBackendEnabled,
  });
});

export {};
