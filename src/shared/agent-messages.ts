import type { AgentEditRequest, AgentEditResponse } from "./agent-contracts.js";

export const OTF_AGENT_MESSAGE = {
  EDIT_REQUEST: "OTF_AGENT_EDIT_REQUEST",
} as const;

export type AgentFailureCode =
  | "agent_disabled"
  | "manual_tool_recommended"
  | "generation_failed"
  | "validation_failed"
  | "timeout"
  | "agent_unavailable"
  | "network_error"
  | "invalid_response"
  | "invalid_url"
  | "agent_http_error"
  | "critic_failed";

export type OtfAgentEditRequestMessage = {
  type: typeof OTF_AGENT_MESSAGE.EDIT_REQUEST;
  request: AgentEditRequest;
};

import type { AgentLatencyStages } from "./agent-latency.js";

export type AgentEditProxySuccess = {
  ok: true;
  response: AgentEditResponse;
  requestId?: string;
  mode?: "mock" | "openai";
  repairAttempted?: boolean;
  latencyMs?: number;
  latencyStages?: AgentLatencyStages;
  contextBudget?: Record<string, unknown>;
};

export type AgentEditProxyFailure = {
  ok: false;
  error: string;
  code: AgentFailureCode;
  details?: string[];
  summary?: string[];
  warnings?: string[];
  requestId?: string;
};

export type AgentEditProxyResult = AgentEditProxySuccess | AgentEditProxyFailure;

export function isAgentEditRequestMessage(value: unknown): value is OtfAgentEditRequestMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === OTF_AGENT_MESSAGE.EDIT_REQUEST &&
    "request" in value &&
    typeof value.request === "object" &&
    value.request !== null
  );
}

export function isAgentEditProxyResult(value: unknown): value is AgentEditProxyResult {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return false;
  }

  if (value.ok === true) {
    return "response" in value && typeof value.response === "object" && value.response !== null;
  }

  return "error" in value && typeof value.error === "string";
}
