import { buildFlags } from "../shared/build-flags.js";

console.info("[On the Fly] content script loaded", {
  publicAgentEnabled: buildFlags.publicAgentEnabled,
  publicBackendEnabled: buildFlags.publicBackendEnabled,
});

export {};
