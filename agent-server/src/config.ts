import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ModelProviderName = "openai";

export interface AgentServerConfig {
  agentEnabled: boolean;
  useMockAgent: boolean;
  modelProvider: ModelProviderName;
  openAiApiKey?: string;
  modelName: string;
  openAiTimeoutMs: number;
  host: string;
  port: number;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  envFilePath?: string;
  cwd?: string;
}

const DEFAULT_CONFIG = {
  agentEnabled: false,
  useMockAgent: true,
  modelProvider: "openai" as const,
  modelName: "gpt-5-mini",
  openAiTimeoutMs: 45_000,
  host: "127.0.0.1",
  port: 4317,
};

export function loadAgentServerConfig(options: LoadConfigOptions = {}): AgentServerConfig {
  const cwd = options.cwd ?? process.cwd();
  const fileEnv = readEnvFile(options.envFilePath ?? findDefaultEnvFile(cwd));
  const env = { ...fileEnv, ...(options.env ?? process.env) };

  const provider = parseModelProvider(env.MODEL_PROVIDER);
  const openAiApiKey = nonEmpty(env.OPENAI_API_KEY);
  const config: AgentServerConfig = {
    agentEnabled: parseBoolean(env.AGENT_ENABLED, DEFAULT_CONFIG.agentEnabled),
    useMockAgent: resolveUseMockAgent(env.AGENT_USE_MOCK, Boolean(openAiApiKey)),
    modelProvider: provider,
    modelName: nonEmpty(env.MODEL_NAME) ?? DEFAULT_CONFIG.modelName,
    openAiTimeoutMs: parseTimeoutMs(env.AGENT_OPENAI_TIMEOUT_MS, DEFAULT_CONFIG.openAiTimeoutMs),
    host: nonEmpty(env.AGENT_SERVER_HOST) ?? DEFAULT_CONFIG.host,
    port: parsePort(env.AGENT_SERVER_PORT, DEFAULT_CONFIG.port),
  };

  if (openAiApiKey) {
    config.openAiApiKey = openAiApiKey;
  }

  return config;
}

function resolveUseMockAgent(explicit: string | undefined, hasApiKey: boolean): boolean {
  const normalized = explicit?.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return !hasApiKey;
}

function findDefaultEnvFile(cwd: string): string {
  const local = resolve(cwd, ".env");
  if (existsSync(local)) {
    return local;
  }
  return resolve(cwd, "agent-server", ".env");
}

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }

  const entries: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = stripQuotes(line.slice(separator + 1).trim());
    if (key) {
      entries[key] = value;
    }
  }
  return entries;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return fallback;
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

function parseTimeoutMs(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
    return fallback;
  }
  return parsed;
}

function parseModelProvider(value: string | undefined): ModelProviderName {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "openai") {
    return "openai";
  }
  throw new Error(`unsupported_model_provider:${normalized}`);
}
