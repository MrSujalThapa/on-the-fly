import type { AgentEditRequest, AgentEditResponse } from "../shared/agent-contracts.js";
import type { AgentLatencyStages } from "../shared/agent-latency.js";
import type { AgentEditProxyResult, AgentFailureCode } from "../shared/agent-messages.js";
import {
  canExtensionCallLocalAgent,
  resolveLocalAgentBaseUrl,
  type AgentAvailabilityFlags,
} from "../shared/agent-request-gate.js";
import {
  isAllowedLocalAgentUrl,
  resolveAgentEndpointUrl,
} from "../shared/local-agent-url.js";

export interface AgentProxyOptions {
  flags: AgentAvailabilityFlags;
  configuredServerUrl?: string;
  fetchImpl?: typeof fetch;
}

export async function proxyAgentEditRequest(
  request: AgentEditRequest,
  options: AgentProxyOptions,
): Promise<AgentEditProxyResult> {
  if (!canExtensionCallLocalAgent(options.flags)) {
    return {
      ok: false,
      error: "agent_disabled_in_public_build",
      code: "agent_disabled",
    };
  }

  const baseUrl = resolveLocalAgentBaseUrl(options.configuredServerUrl);
  if (!isAllowedLocalAgentUrl(baseUrl)) {
    return {
      ok: false,
      error: "agent_url_not_allowed",
      code: "invalid_url",
    };
  }

  const endpoint = resolveAgentEndpointUrl(baseUrl, "/agent/edit");
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

    const body: unknown = await response.json();
    const requestId = readRequestId(body);

    if (!response.ok) {
      return parseAgentProxyFailure(body, response.status, requestId);
    }

    const manualTool = parseManualToolRecommendation(body, requestId);
    if (manualTool) {
      return manualTool;
    }

    const parsed = parseAgentEditResponse(body, requestId);
    if (!parsed.ok) {
      return parsed;
    }

    return parsed;
  } catch {
    return {
      ok: false,
      error: "agent_unreachable",
      code: "network_error",
    };
  }
}

function parseManualToolRecommendation(
  body: unknown,
  requestId?: string,
): AgentEditProxyResult | null {
  if (!isRecord(body) || body.ok !== true || body.status !== "manual_tool_recommended") {
    return null;
  }

  const guidance = isRecord(body.guidance) ? body.guidance : {};
  const summary = readStringArray(guidance.summary);
  const warnings = readStringArray(guidance.warnings);

  return {
    ok: false,
    code: "manual_tool_recommended",
    error: summary[0] ?? "Use the manual toolbar for this edit.",
    summary,
    warnings,
    ...(requestId ? { requestId } : {}),
  };
}

function parseAgentProxyFailure(
  body: unknown,
  status: number,
  requestId?: string,
): AgentEditProxyResult {
  const record = isRecord(body) ? body : {};
  const code = resolveFailureCode(record, status);
  const details = readStringArray(record.details);
  const error =
    typeof record.error === "string"
      ? record.error
      : typeof record.message === "string"
        ? record.message
        : "agent_request_failed";

  return {
    ok: false,
    error,
    code,
    ...(details.length > 0 ? { details } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

function resolveFailureCode(record: Record<string, unknown>, status: number): AgentFailureCode {
  const explicit = record.code;
  if (explicit === "timeout") {
    return "timeout";
  }
  if (explicit === "validation_failed") {
    return "validation_failed";
  }
  if (explicit === "agent_unavailable") {
    return "agent_unavailable";
  }
  if (explicit === "generation_failed") {
    return "generation_failed";
  }
  if (status === 504) {
    return "timeout";
  }
  if (status === 422) {
    return "validation_failed";
  }
  if (status === 503 || status === 501) {
    return "agent_unavailable";
  }
  if (status === 502) {
    return "generation_failed";
  }
  return "agent_http_error";
}

function parseAgentEditResponse(
  body: unknown,
  requestId?: string,
): AgentEditProxyResult {
  const payload =
    typeof body === "object" &&
    body !== null &&
    "response" in body &&
    typeof body.response === "object" &&
    body.response !== null
      ? body.response
      : body;

  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "invalid_agent_response", code: "invalid_response" };
  }

  const candidate = payload as Record<string, unknown>;
  if (
    !Array.isArray(candidate.draftOperations) ||
    !Array.isArray(candidate.summary) ||
    !Array.isArray(candidate.warnings) ||
    (candidate.confidence !== "low" &&
      candidate.confidence !== "medium" &&
      candidate.confidence !== "high")
  ) {
    return { ok: false, error: "invalid_agent_response", code: "invalid_response" };
  }

  const envelope = isRecord(body) ? body : {};
  const mode = readString(envelope.mode);
  const latencyStages = readLatencyStages(envelope.latencyStages);

  return {
    ok: true,
    response: {
      draftOperations: candidate.draftOperations as AgentEditResponse["draftOperations"],
      summary: candidate.summary.map(String),
      warnings: candidate.warnings.map(String),
      confidence: candidate.confidence,
    },
    ...(requestId ? { requestId } : {}),
    ...(mode === "mock" || mode === "openai" ? { mode } : {}),
    ...(envelope.repairAttempted === true ? { repairAttempted: true } : {}),
    ...(typeof envelope.latencyMs === "number" && Number.isFinite(envelope.latencyMs)
      ? { latencyMs: envelope.latencyMs }
      : {}),
    ...(latencyStages ? { latencyStages } : {}),
    ...(isRecord(envelope.contextBudget) ? { contextBudget: envelope.contextBudget } : {}),
  };
}

function readLatencyStages(value: unknown): AgentLatencyStages | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const stages: AgentLatencyStages = {};
  for (const key of [
    "contextBuildMs",
    "serverRequestMs",
    "openAiCallMs",
    "compileMs",
    "validationMs",
    "previewApplyMs",
    "serverTotalMs",
    "totalMs",
  ] as const) {
    const entry = value[key];
    if (typeof entry === "number" && Number.isFinite(entry)) {
      stages[key] = entry;
    }
  }

  return Object.keys(stages).length > 0 ? stages : undefined;
}

function readRequestId(body: unknown): string | undefined {
  if (!isRecord(body) || typeof body.requestId !== "string") {
    return undefined;
  }
  return body.requestId;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
