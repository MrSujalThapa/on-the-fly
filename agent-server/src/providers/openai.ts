import type { AgentEditRequest, AgentEditResponse } from "../../../src/shared/agent-contracts.js";
import { parseModelAgentEditResponse } from "../response-validation.js";
import { buildOpenAiSystemPrompt, buildOpenAiUserPrompt } from "../openai-prompt.js";
import { AGENT_EDIT_RESPONSE_JSON_SCHEMA } from "../openai-schema.js";
import {
  isUnsupportedProviderParameterError,
  resolveOpenAiTemperature,
} from "../model-parameters.js";
import type { ModelProviderAdapter, StructuredGenerationOptions } from "./types.js";

export interface OpenAiAdapterOptions {
  apiKey?: string;
  modelName: string;
  fetchImpl?: typeof fetch;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class OpenAiAdapter implements ModelProviderAdapter {
  readonly id = "openai";
  readonly provider = "openai";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiAdapterOptions) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw new Error("missing_openai_api_key_for_local_agent");
    }

    if (!options.modelName.trim()) {
      throw new Error("missing_model_name_for_local_agent");
    }

    this.apiKey = apiKey;
    this.modelName = options.modelName.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateStructuredOperations(
    request: AgentEditRequest,
    options: StructuredGenerationOptions = {},
  ): Promise<AgentEditResponse> {
    const messages = [
      { role: "system" as const, content: buildOpenAiSystemPrompt() },
      { role: "user" as const, content: buildOpenAiUserPrompt(request) },
    ];

    if (options.repairErrors && options.repairErrors.length > 0) {
      messages.push({
        role: "user" as const,
        content: [
          "Your previous JSON output failed local validation.",
          "Fix every issue below and return corrected structured operations only.",
          "Do not return partial operations or explanations outside JSON.",
          "",
          ...options.repairErrors.map((error) => `- ${error}`),
        ].join("\n"),
      });
    }

    const requestBody: Record<string, unknown> = {
      model: this.modelName,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "agent_edit_response",
          strict: false,
          schema: AGENT_EDIT_RESPONSE_JSON_SCHEMA,
        },
      },
    };

    const temperature = resolveOpenAiTemperature(this.modelName, Boolean(options.repairErrors));
    if (temperature !== undefined) {
      requestBody.temperature = temperature;
    }

    const response = await this.fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...(options.requestId ? { "x-otf-request-id": options.requestId } : {}),
      },
      body: JSON.stringify(requestBody),
      ...(options.timeoutSignal ? { signal: options.timeoutSignal } : {}),
    });

    const body = (await response.json()) as OpenAiChatCompletionResponse;
    if (!response.ok) {
      const message = body.error?.message ?? `openai_request_failed_${String(response.status)}`;
      const code = isUnsupportedProviderParameterError(message)
        ? "provider_config_error"
        : "provider_error";
      throw new OpenAiGenerationError(message, code);
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new OpenAiGenerationError("openai_returned_empty_content", "provider_error");
    }

    const parsed = parseModelAgentEditResponse(content, request);
    if (!parsed.ok) {
      throw new OpenAiGenerationError(parsed.errors.join("; "), parsed.code);
    }

    return parsed.response;
  }
}

export class OpenAiGenerationError extends Error {
  readonly code:
    | "malformed_json"
    | "invalid_model_output"
    | "unsafe_model_output"
    | "provider_error"
    | "provider_config_error";

  constructor(message: string, code: OpenAiGenerationError["code"]) {
    super(message);
    this.name = "OpenAiGenerationError";
    this.code = code;
  }
}
