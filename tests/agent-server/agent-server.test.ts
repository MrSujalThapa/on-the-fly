import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentServerConfig } from "../../agent-server/src/config.js";
import { loadAgentServerConfig } from "../../agent-server/src/config.js";
import {
  createLocalAgentServer,
  createProviderAdapter,
  OpenAiAdapter,
  OpenAiGenerationError,
  type ModelProviderAdapter,
} from "../../agent-server/src/index.js";
import { createInsertHelperObjectOperation } from "../editor/fixtures.js";

const BASE_CONFIG: AgentServerConfig = {
  agentEnabled: false,
  useMockAgent: true,
  modelProvider: "openai",
  modelName: "gpt-5-mini",
  openAiTimeoutMs: 45_000,
  host: "127.0.0.1",
  port: 0,
};

let openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.map(closeServer));
  openServers = [];
});

describe("local agent server skeleton", () => {
  it("is disabled by default", () => {
    const config = loadAgentServerConfig({
      env: {},
      envFilePath: "does-not-exist.env",
    });

    expect(config.agentEnabled).toBe(false);
    expect(config.modelProvider).toBe("openai");
    expect(config.modelName).toBe("gpt-5-mini");
    expect(config.openAiTimeoutMs).toBe(25_000);
  });

  it("does not instantiate an adapter when AGENT_ENABLED=false", () => {
    const adapter = createProviderAdapter(BASE_CONFIG);

    expect(adapter).toBeNull();
  });

  it("fails safely when enabled for real generation without an OpenAI key", () => {
    expect(() =>
      createProviderAdapter({
        ...BASE_CONFIG,
        agentEnabled: true,
        useMockAgent: false,
      }),
    ).toThrow("missing_openai_api_key_for_local_agent");
  });

  it("does not instantiate an adapter when mock mode is enabled", () => {
    const adapter = createProviderAdapter({
      ...BASE_CONFIG,
      agentEnabled: true,
      useMockAgent: true,
      openAiApiKey: "secret",
    });

    expect(adapter).toBeNull();
  });

  it("keeps the provider adapter interface swappable", () => {
    const adapter: ModelProviderAdapter = new OpenAiAdapter({
      apiKey: "local-test-key",
      modelName: "gpt-5-mini",
    });

    expect(adapter.provider).toBe("openai");
    expect(adapter.modelName).toBe("gpt-5-mini");
    expect(typeof adapter.generateStructuredOperations).toBe("function");
  });

  it("serves health without exposing secrets", async () => {
    const server = await listen(
      createLocalAgentServer({
        config: {
          ...BASE_CONFIG,
          openAiApiKey: "secret-value",
        },
      }),
    );

    const response = await fetchJson(server, "/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ok",
      agentEnabled: false,
      provider: "openai",
      modelName: "gpt-5-mini",
    });
    expect(JSON.stringify(response.body)).not.toContain("secret-value");
  });

  it("returns mock preview operations when enabled", async () => {
    const server = await listen(
      createLocalAgentServer({
        config: { ...BASE_CONFIG, agentEnabled: true },
      }),
    );

    const invalid = await fetchJson(server, "/agent/edit", {
      method: "POST",
      body: JSON.stringify({ pageKey: "https://example.com/" }),
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("invalid_agent_edit_request");

    const valid = await fetchJson(server, "/agent/edit", {
      method: "POST",
      body: JSON.stringify({
        pageKey: "https://example.com/",
        instruction: "Make this selected card feel more premium.",
        selection: { selectedNodeIds: ["node-1"], source: "click" },
        selectedNodes: [
          {
            id: "node-1",
            kind: "text",
            signature: {
              cssPath: "main article p",
              tagName: "p",
              classList: [],
              boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
            },
            rect: { x: 10, y: 20, width: 120, height: 40 },
            computed: {},
            childIds: [],
          },
        ],
        nearbyNodes: [],
        existingOperations: [],
      }),
    });

    expect(valid.status).toBe(200);
    expect(valid.body.ok).toBe(true);
    expect(valid.body.mode).toBe("mock");
    const response = valid.body.response as Record<string, unknown>;
    expect(Array.isArray(response.draftOperations)).toBe(true);
    expect((response.draftOperations as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((response.draftOperations as Array<{ type: string }>).some((op) => op.type === "insertHelperObject")).toBe(true);
  });

  it("returns validation error for unsafe provider output", async () => {
    const server = await listen(
      createLocalAgentServer({
        config: {
          ...BASE_CONFIG,
          agentEnabled: true,
          useMockAgent: false,
          openAiApiKey: "test-key",
        },
        providerOverride: {
          id: "test",
          provider: "test",
          modelName: "test-model",
          generateStructuredOperations: () => {
            throw new OpenAiGenerationError(
              "operations[0].type duplicate is not allowed",
              "unsafe_model_output",
            );
          },
        },
      }),
    );

    const result = await fetchJson(server, "/agent/edit", {
      method: "POST",
      body: JSON.stringify({
        pageKey: "https://example.com/",
        instruction: "Make this selected card feel more premium.",
        selection: { selectedNodeIds: ["node-1"], source: "click" },
        selectedNodes: [],
        nearbyNodes: [],
        existingOperations: [],
      }),
    });

    expect(result.status).toBe(422);
    expect(result.body.error).toBe("invalid_model_output");
    expect(result.body.code).toBe("validation_failed");
  });

  it("returns manual tool recommendation without calling the provider", async () => {
    const generateStructuredOperations = vi.fn();
    const server = await listen(
      createLocalAgentServer({
        config: {
          ...BASE_CONFIG,
          agentEnabled: true,
          useMockAgent: false,
          openAiApiKey: "test-key",
        },
        providerOverride: {
          id: "test",
          provider: "test",
          modelName: "test-model",
          generateStructuredOperations,
        },
      }),
    );

    const result = await fetchJson(server, "/agent/edit", {
      method: "POST",
      body: JSON.stringify({
        pageKey: "https://example.com/",
        instruction: "make text red",
        selection: { selectedNodeIds: ["node-1"], source: "click" },
        selectedNodes: [],
        nearbyNodes: [],
        existingOperations: [],
      }),
    });

    expect(result.status).toBe(200);
    expect(result.body.status).toBe("manual_tool_recommended");
    expect(generateStructuredOperations).not.toHaveBeenCalled();
  });

  it("calls the provider for agent-worthy requests in real mode", async () => {
    const helperOperation = createInsertHelperObjectOperation({
      source: "agent",
      status: "preview",
    });
    const generateStructuredOperations = vi.fn(() =>
      Promise.resolve({
        draftOperations: [helperOperation],
        summary: ["Added panel"],
        warnings: [],
        confidence: "high" as const,
      }),
    );

    const server = await listen(
      createLocalAgentServer({
        config: {
          ...BASE_CONFIG,
          agentEnabled: true,
          useMockAgent: false,
          openAiApiKey: "test-key",
        },
        providerOverride: {
          id: "test",
          provider: "test",
          modelName: "test-model",
          generateStructuredOperations,
        },
      }),
    );

    const result = await fetchJson(server, "/agent/edit", {
      method: "POST",
      body: JSON.stringify({
        pageKey: "https://example.com/",
        instruction: "Make this selected card feel more premium.",
        selection: { selectedNodeIds: ["node-1"], source: "click" },
        selectedNodes: [],
        nearbyNodes: [],
        existingOperations: [],
      }),
    });

    expect(result.status).toBe(200);
    expect(result.body.mode).toBe("openai");
    expect(generateStructuredOperations).toHaveBeenCalledTimes(1);
  });

  it("rejects edit requests when disabled", async () => {
    const server = await listen(createLocalAgentServer({ config: BASE_CONFIG }));

    const valid = await fetchJson(server, "/agent/edit", {
      method: "POST",
      body: JSON.stringify({
        pageKey: "https://example.com/",
        instruction: "Make this selected card feel more premium.",
        selection: { selectedNodeIds: ["node-1"], source: "click" },
        selectedNodes: [],
        nearbyNodes: [],
        existingOperations: [],
      }),
    });

    expect(valid.status).toBe(501);
    expect(valid.body.error).toBe("local_agent_disabled");
  });
});

async function listen(server: Server): Promise<Server> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  openServers.push(server);
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function fetchJson(
  server: Server,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const address = server.address() as AddressInfo;
  const body = init.body ?? "";

  return await new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path,
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: response.statusCode ?? 0,
          body: JSON.parse(text) as Record<string, unknown>,
        });
      });
    });

    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}
