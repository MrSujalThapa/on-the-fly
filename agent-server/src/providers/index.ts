import type { AgentServerConfig } from "../config.js";
import { OpenAiAdapter } from "./openai.js";
import type { ModelProviderAdapter } from "./types.js";

export function createProviderAdapter(config: AgentServerConfig): ModelProviderAdapter | null {
  if (!config.agentEnabled || config.useMockAgent) {
    return null;
  }

  return new OpenAiAdapter({
    modelName: config.modelName,
    ...(config.openAiApiKey ? { apiKey: config.openAiApiKey } : {}),
  });
}

export type { ModelProviderAdapter, StructuredGenerationOptions } from "./types.js";
export { OpenAiAdapter };
