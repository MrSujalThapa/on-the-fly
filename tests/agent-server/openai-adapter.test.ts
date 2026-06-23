import { describe, expect, it, vi } from "vitest";
import type { AgentEditRequest } from "../../src/shared/agent-contracts.js";
import { OpenAiAdapter, OpenAiGenerationError } from "../../agent-server/src/providers/openai.js";
import { createInsertHelperObjectOperation } from "../editor/fixtures.js";

const BASE_REQUEST: AgentEditRequest = {
  pageKey: "https://example.com/",
  instruction: "Make this card feel more premium.",
  selection: { selectedNodeIds: ["node-1"], source: "click" },
  selectedNodes: [
    {
      id: "node-1",
      kind: "container",
      signature: {
        cssPath: "main article.card",
        tagName: "article",
        classList: ["card"],
        boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
      },
      rect: { x: 10, y: 20, width: 120, height: 80 },
      computed: {},
      childIds: [],
    },
  ],
  nearbyNodes: [],
  existingOperations: [],
};

describe("OpenAiAdapter", () => {
  it("is not constructed when the API key is missing", () => {
    expect(
      () =>
        new OpenAiAdapter({
          modelName: "gpt-5-mini",
        }),
    ).toThrow("missing_openai_api_key_for_local_agent");
  });

  it("rejects unsafe model output after the provider call", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  draftOperations: [
                    {
                      id: "dup",
                      type: "duplicate",
                      pageKey: BASE_REQUEST.pageKey,
                      target: { nodeId: "node-1" },
                      payload: { html: "<div>bad</div>" },
                      createdAt: 1,
                      source: "agent",
                      status: "preview",
                    },
                  ],
                  summary: [],
                  warnings: [],
                  confidence: "low",
                }),
              },
            },
          ],
        }),
      ),
    );

    const adapter = new OpenAiAdapter({
      apiKey: "test-key",
      modelName: "gpt-5-mini",
      fetchImpl,
    });

    await expect(adapter.generateStructuredOperations(BASE_REQUEST)).rejects.toBeInstanceOf(
      OpenAiGenerationError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("omits unsupported temperature for GPT-5-mini requests", async () => {
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        Response.json({
          choices: [{ message: { content: null } }],
        }),
      ),
    );

    const adapter = new OpenAiAdapter({
      apiKey: "test-key",
      modelName: "gpt-5-mini",
      fetchImpl,
    });

    await expect(adapter.generateStructuredOperations(BASE_REQUEST)).rejects.toBeInstanceOf(
      OpenAiGenerationError,
    );

    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    const init = call?.[1];
    const rawBody = init?.body;
    const body = JSON.parse(typeof rawBody === "string" ? rawBody : "{}") as Record<string, unknown>;
    expect(body.temperature).toBeUndefined();
  });

  it("maps unsupported provider parameters to provider_config_error", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json(
          { error: { message: "Unsupported parameter: 'temperature' is not supported with this model." } },
          { status: 400 },
        ),
      ),
    );

    const adapter = new OpenAiAdapter({
      apiKey: "test-key",
      modelName: "gpt-5-mini",
      fetchImpl,
    });

    await expect(adapter.generateStructuredOperations(BASE_REQUEST)).rejects.toMatchObject({
      code: "provider_config_error",
    });
  });

  it("returns validated operations from structured OpenAI content", async () => {
    const helperOperation = createInsertHelperObjectOperation({
      source: "agent",
      status: "preview",
    });

    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  draftOperations: [helperOperation],
                  summary: ["Added a soft background panel."],
                  warnings: [],
                  confidence: "high",
                }),
              },
            },
          ],
        }),
      ),
    );

    const adapter = new OpenAiAdapter({
      apiKey: "test-key",
      modelName: "gpt-5-mini",
      fetchImpl,
    });

    const response = await adapter.generateStructuredOperations(BASE_REQUEST);

    expect(response.draftOperations).toHaveLength(1);
    expect(response.draftOperations[0]?.type).toBe("insertHelperObject");
    expect(response.summary[0]).toContain("background panel");
  });
});
