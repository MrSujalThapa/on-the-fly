import { buildFlags, isAgentEnabled } from "../shared/build-flags.js";

const buildMode = document.querySelector<HTMLElement>("#build-mode");
const agentMode = document.querySelector<HTMLElement>("#agent-mode");

if (buildMode) {
  buildMode.textContent = isAgentEnabled() ? "Local developer" : "Public";
}

if (agentMode) {
  agentMode.textContent = buildFlags.publicAgentEnabled ? "Enabled" : "Disabled";
}

console.info("[On the Fly] options opened", buildFlags);
