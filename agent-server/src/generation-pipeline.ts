import type { AgentEditRequest, AgentEditResponse } from "../../src/shared/agent-contracts.js";
import type { AgentLatencyStages } from "../../src/shared/agent-latency.js";
import type { ContextBudgetMetadata } from "./context-budget.js";
import { applyContextBudget } from "./context-budget.js";
import { OpenAiGenerationError } from "./providers/openai.js";
import type { ModelProviderAdapter } from "./providers/index.js";

export class AgentGenerationTimeoutError extends Error {
  readonly code = "timeout" as const;

  constructor(timeoutMs: number) {
    super(`openai_generation_timeout_${String(timeoutMs)}ms`);
    this.name = "AgentGenerationTimeoutError";
  }
}

export interface GenerationPipelineOptions {
  timeoutMs: number;
  requestId: string;
}

export interface GenerationPipelineResult {
  response: AgentEditResponse;
  budget: ContextBudgetMetadata;
  repairAttempted: boolean;
  latencyStages: AgentLatencyStages;
}

export async function runAgentGenerationPipeline(
  adapter: ModelProviderAdapter,
  request: AgentEditRequest,
  options: GenerationPipelineOptions,
): Promise<GenerationPipelineResult> {
  const budgeted = applyContextBudget(request);

  try {
    const generated = await generateWithTimeout(adapter, budgeted.request, options);
    return {
      response: generated.response,
      budget: budgeted.budget,
      repairAttempted: false,
      latencyStages: generated.latencyStages,
    };
  } catch (error) {
    if (!(error instanceof OpenAiGenerationError) || !isRepairableValidationError(error)) {
      throw error;
    }

    const repairGenerated = await generateWithTimeout(adapter, budgeted.request, options, {
      repairErrors: error.message.split("; "),
    });

    return {
      response: repairGenerated.response,
      budget: budgeted.budget,
      repairAttempted: true,
      latencyStages: repairGenerated.latencyStages,
    };
  }
}

async function generateWithTimeout(
  adapter: ModelProviderAdapter,
  request: AgentEditRequest,
  options: GenerationPipelineOptions,
  extra: { repairErrors?: string[] } = {},
): Promise<{ response: AgentEditResponse; latencyStages: AgentLatencyStages }> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);

  const latencyStages: AgentLatencyStages = {};

  try {
    const response = await adapter.generateStructuredOperations(request, {
      requestId: options.requestId,
      timeoutSignal: controller.signal,
      latencyOut: latencyStages,
      ...(extra.repairErrors ? { repairErrors: extra.repairErrors } : {}),
    });
    return { response, latencyStages };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AgentGenerationTimeoutError(options.timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isRepairableValidationError(error: OpenAiGenerationError): boolean {
  return (
    error.code === "invalid_model_output" ||
    error.code === "unsafe_model_output" ||
    error.code === "malformed_json"
  );
}
