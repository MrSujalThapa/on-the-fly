import type {
  AgentEditRequest,
  AgentEditResponse,
} from "../../../src/shared/agent-contracts.js";

export interface StructuredGenerationOptions {
  schema?: unknown;
  repairErrors?: string[];
  requestId?: string;
  timeoutSignal?: AbortSignal;
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
