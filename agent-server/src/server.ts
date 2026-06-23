import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentServerConfig } from "./config.js";
import { loadAgentServerConfig } from "./config.js";
import { validateAgentEditRequestShape } from "./request-validation.js";
import { buildMockAgentEditResponse } from "./mock-response.js";
import { shouldRouteToManualTool } from "./intent-router.js";
import { AgentGenerationTimeoutError, runAgentGenerationPipeline } from "./generation-pipeline.js";
import { OpenAiGenerationError } from "./providers/openai.js";
import { createProviderAdapter, type ModelProviderAdapter } from "./providers/index.js";

const MAX_REQUEST_BYTES = 1024 * 1024;

export interface HealthResponse {
  status: "ok";
  agentEnabled: boolean;
  provider: string;
  modelName: string;
}

export interface LocalAgentServerOptions {
  config?: AgentServerConfig;
  providerOverride?: ModelProviderAdapter | null;
}

export function createLocalAgentServer(options: LocalAgentServerOptions = {}): Server {
  const config = options.config ?? loadAgentServerConfig();

  return createServer((request, response) => {
    void routeRequest(request, response, config, options.providerOverride);
  });
}

export async function startLocalAgentServer(
  options: LocalAgentServerOptions = {},
): Promise<Server> {
  const config = options.config ?? loadAgentServerConfig();
  const server = createLocalAgentServer({
    config,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  const host = address?.address ?? config.host;
  const port = address?.port ?? config.port;
  console.log(
    `[on-the-fly-agent] local server listening on http://${host}:${String(port)} ` +
      `(enabled=${String(config.agentEnabled)}, provider=${config.modelProvider}, model=${config.modelName})`,
  );

  return server;
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: AgentServerConfig,
  providerOverride?: ModelProviderAdapter | null,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, {
        status: "ok",
        agentEnabled: config.agentEnabled,
        provider: config.modelProvider,
        modelName: config.modelName,
      } satisfies HealthResponse);
      return;
    }

    if (request.method === "POST" && url.pathname === "/agent/edit") {
      await handleAgentEdit(request, response, config, providerOverride);
      return;
    }

    writeJson(response, 404, { ok: false, error: "not_found" });
  } catch (error) {
    writeJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "internal_server_error",
    });
  }
}

async function handleAgentEdit(
  request: IncomingMessage,
  response: ServerResponse,
  config: AgentServerConfig,
  providerOverride?: ModelProviderAdapter | null,
): Promise<void> {
  const requestId = resolveRequestId(request);
  const startedAt = Date.now();
  const body = await readJsonBody(request);
  if (!body.ok) {
    writeJson(response, 400, { ok: false, error: body.error, requestId });
    return;
  }

  const useMock = shouldUseMockResponse(body.value, config);
  const validation = validateAgentEditRequestShape(body.value);
  if (!validation.ok) {
    writeJson(response, 400, {
      ok: false,
      error: "invalid_agent_edit_request",
      details: validation.errors,
      requestId,
    });
    return;
  }

  if (!config.agentEnabled) {
    writeJson(response, 501, {
      ok: false,
      code: "agent_unavailable",
      error: "local_agent_disabled",
      message: "Local agent generation is disabled. Set AGENT_ENABLED=true in local development only.",
      requestId,
    });
    return;
  }

  const manualRecommendation = shouldRouteToManualTool(validation.request);
  if (manualRecommendation) {
    logAgentEvent(requestId, "manual_tool_recommended", {
      matchedIntent: manualRecommendation.matchedIntent,
      latencyMs: Date.now() - startedAt,
      validationStatus: "manual_tool_recommended",
    });
    writeJson(response, 200, {
      ok: true,
      status: "manual_tool_recommended",
      guidance: manualRecommendation,
      requestId,
    });
    return;
  }

  if (useMock) {
    const mockResponse = buildMockAgentEditResponse(validation.request);
    const latencyMs = Date.now() - startedAt;
    logAgentEvent(requestId, "mock_generation", {
      mode: "mock",
      latencyMs,
      validationStatus: "ok",
      repairAttempted: false,
      contextBudgetSize: summarizeContextBudget(validation.request),
    });
    writeJson(response, 200, {
      ok: true,
      response: mockResponse,
      mode: "mock",
      requestId,
      latencyMs,
      repairAttempted: false,
    });
    return;
  }

  let adapter: ModelProviderAdapter | null;
  if (providerOverride !== undefined) {
    adapter = providerOverride;
  } else {
    try {
      adapter = createProviderAdapter(config);
    } catch (error) {
      writeJson(response, 503, {
        ok: false,
        code: "agent_unavailable",
        error: error instanceof Error ? error.message : "provider_unavailable",
        message: "Configure OPENAI_API_KEY and MODEL_NAME in agent-server/.env for real generation, or set AGENT_USE_MOCK=true.",
        requestId,
      });
      return;
    }
  }

  if (!adapter) {
    writeJson(response, 503, {
      ok: false,
      code: "agent_unavailable",
      error: "provider_unavailable",
      message: "No model provider is configured. Set OPENAI_API_KEY or enable AGENT_USE_MOCK=true.",
      requestId,
    });
    return;
  }

  try {
    const generated = await runAgentGenerationPipeline(adapter, validation.request, {
      timeoutMs: config.openAiTimeoutMs,
      requestId,
    });
    const latencyMs = Date.now() - startedAt;
    logAgentEvent(requestId, "openai_generation", {
      mode: "openai",
      latencyMs,
      repairAttempted: generated.repairAttempted,
      validationStatus: "ok",
      contextBudget: generated.budget,
      latencyStages: {
        ...generated.latencyStages,
        serverTotalMs: latencyMs,
      },
    });
    writeJson(response, 200, {
      ok: true,
      response: generated.response,
      mode: "openai",
      requestId,
      repairAttempted: generated.repairAttempted,
      latencyMs,
      latencyStages: {
        ...generated.latencyStages,
        serverTotalMs: latencyMs,
      },
      contextBudget: generated.budget,
    });
  } catch (error) {
    if (error instanceof AgentGenerationTimeoutError) {
      writeJson(response, 504, {
        ok: false,
        code: "timeout",
        error: error.message,
        requestId,
      });
      return;
    }

    if (error instanceof OpenAiGenerationError) {
      if (error.code === "provider_config_error" || error.code === "provider_error") {
        writeJson(response, 502, {
          ok: false,
          code: error.code === "provider_config_error" ? "provider_config_error" : "generation_failed",
          error: error.message,
          requestId,
        });
        return;
      }

      writeJson(response, 422, {
        ok: false,
        code: "validation_failed",
        error: "invalid_model_output",
        details: error.message.split("; "),
        requestId,
      });
      return;
    }

    writeJson(response, 502, {
      ok: false,
      code: "generation_failed",
      error: error instanceof Error ? error.message : "generation_failed",
      requestId,
    });
  }
}

function resolveRequestId(request: IncomingMessage): string {
  const header = request.headers["x-otf-request-id"];
  const candidate = Array.isArray(header) ? header[0] : header;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.trim().slice(0, 80);
  }
  return `otf-${randomUUID()}`;
}

function logAgentEvent(requestId: string, event: string, data: Record<string, unknown>): void {
  console.log(
    `[on-the-fly-agent] requestId=${requestId} event=${event} ${JSON.stringify(sanitizeLogData(data))}`,
  );
}

function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && value.length > 500) {
      sanitized[key] = `${value.slice(0, 500)}…`;
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function summarizeContextBudget(request: import("../../src/shared/agent-contracts.js").AgentEditRequest): {
  selectedNodes: number;
  nearbyNodes: number;
  existingOperations: number;
  instructionChars: number;
} {
  return {
    selectedNodes: request.selectedNodes.length,
    nearbyNodes: request.nearbyNodes.length,
    existingOperations: request.existingOperations.length,
    instructionChars: request.instruction.length,
  };
}

function shouldUseMockResponse(body: unknown, config: AgentServerConfig): boolean {
  if (config.useMockAgent) {
    return true;
  }

  if (isRecord(body) && body.useMock === true) {
    return true;
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request as AsyncIterable<unknown>) {
    const buffer = toBuffer(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      return { ok: false, error: "request_too_large" };
    }
    chunks.push(buffer);
  }

  try {
    const text = Buffer.concat(chunks).toString("utf8");
    return { ok: true, value: text ? JSON.parse(text) : null };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  if (typeof chunk === "string") {
    return Buffer.from(chunk);
  }
  return Buffer.from(String(chunk));
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}
