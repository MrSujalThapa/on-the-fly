import type { AgentEditRequest } from "../../shared/agent-contracts.js";
import {
  isAgentEditProxyResult,
  OTF_AGENT_MESSAGE,
  type AgentEditProxyResult,
} from "../../shared/agent-messages.js";
import { isLocalAgentAvailable } from "../../shared/build-flags.js";

export async function sendAgentEditRequest(
  request: AgentEditRequest,
): Promise<AgentEditProxyResult> {
  if (!isLocalAgentAvailable()) {
    return {
      ok: false,
      error: "agent_disabled_in_public_build",
      code: "agent_disabled",
    };
  }

  const response: unknown = await chrome.runtime.sendMessage({
    type: OTF_AGENT_MESSAGE.EDIT_REQUEST,
    request,
  });

  if (!isAgentEditProxyResult(response)) {
    return {
      ok: false,
      error: "invalid_agent_proxy_response",
      code: "invalid_response",
    };
  }

  return response;
}
