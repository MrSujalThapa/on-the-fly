import { pathToFileURL } from "node:url";
import { startLocalAgentServer } from "./server.js";

export { loadAgentServerConfig, type AgentServerConfig } from "./config.js";
export {
  createLocalAgentServer,
  startLocalAgentServer,
  type HealthResponse,
} from "./server.js";
export {
  createProviderAdapter,
  OpenAiAdapter,
  type ModelProviderAdapter,
  type StructuredGenerationOptions,
} from "./providers/index.js";
export { parseModelAgentEditResponse, type ModelResponseParseResult } from "./response-validation.js";
export { OpenAiGenerationError } from "./providers/openai.js";
export { validateAgentEditRequestShape } from "./request-validation.js";
export { classifyAgentInstruction, shouldRouteToManualTool } from "./intent-router.js";
export { applyContextBudget, CONTEXT_BUDGET_LIMITS } from "./context-budget.js";
export { runAgentGenerationPipeline, AgentGenerationTimeoutError } from "./generation-pipeline.js";

if (isDirectRun()) {
  startLocalAgentServer().catch((error: unknown) => {
    console.error(
      `[on-the-fly-agent] failed to start: ${
        error instanceof Error ? error.message : "unknown_error"
      }`,
    );
    process.exitCode = 1;
  });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry ? import.meta.url === pathToFileURL(entry).href : false;
}
