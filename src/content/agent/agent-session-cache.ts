import type { AgentEditResponse } from "../../shared/agent-contracts.js";
import type { AgentLatencyStages } from "../../shared/agent-latency.js";

export interface CachedAgentResponse {
  response: AgentEditResponse;
  latencyStages: AgentLatencyStages;
}

const sessionCache = new Map<string, CachedAgentResponse>();

export function buildAgentCacheKey(scopeKey: string, instruction: string): string {
  return `${scopeKey}|${instruction.trim().toLowerCase()}`;
}

export function getCachedAgentResponse(key: string): CachedAgentResponse | undefined {
  return sessionCache.get(key);
}

export function setCachedAgentResponse(key: string, entry: CachedAgentResponse): void {
  sessionCache.set(key, entry);
}

export function clearAgentSessionCache(): void {
  sessionCache.clear();
}

/** Test helper — not for production use outside tests. */
export function getAgentSessionCacheSize(): number {
  return sessionCache.size;
}
