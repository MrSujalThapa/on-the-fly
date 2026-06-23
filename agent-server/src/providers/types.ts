import type {
  AgentEditRequest,
  AgentEditResponse,
} from "../../../src/shared/agent-contracts.js";
import type { AgentLatencyStages } from "../../../src/shared/agent-latency.js";

export interface StructuredGenerationOptions {
  schema?: unknown;
  repairErrors?: string[];
  requestId?: string;
  timeoutSignal?: AbortSignal;
  latencyOut?: AgentLatencyStages;
}

export interface ModelProviderAdapter {
  readonly id: string;
  readonly provider: string;
  readonly modelName: string;
  generateStructuredOperations: (
    request: AgentEditRequest,
    options?: StructuredGenerationOptions,
  ) => Promise<AgentEditResponse>;
}
