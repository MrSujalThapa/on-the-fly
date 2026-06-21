import { buildFlags, isAgentEnabled } from "../shared/build-flags.js";

const status = document.querySelector<HTMLElement>(".status");
if (status) {
  status.textContent = isAgentEnabled()
    ? "Local developer build (agent enabled)."
    : "Public build (agent disabled).";
}

console.info("[On the Fly] popup opened", buildFlags);
