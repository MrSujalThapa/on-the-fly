/** Stage timings for agent request diagnostics (milliseconds). */
export interface AgentLatencyStages {
  contextBuildMs?: number;
  serverRequestMs?: number;
  openAiCallMs?: number;
  compileMs?: number;
  validationMs?: number;
  previewApplyMs?: number;
  serverTotalMs?: number;
  totalMs?: number;
  bottleneck?: LatencyBottleneck;
  cacheHit?: boolean;
}

export type LatencyBottleneck =
  | "openai"
  | "server_compile_validation"
  | "extension_preview"
  | "extension_context"
  | "network"
  | "unknown";

export function mergeLatencyStages(
  base: AgentLatencyStages,
  extra: AgentLatencyStages,
): AgentLatencyStages {
  return { ...base, ...extra };
}

export function identifyLatencyBottleneck(stages: AgentLatencyStages): LatencyBottleneck {
  const openAi = stages.openAiCallMs ?? 0;
  const compile = stages.compileMs ?? 0;
  const validation = stages.validationMs ?? 0;
  const previewApply = stages.previewApplyMs ?? 0;
  const contextBuild = stages.contextBuildMs ?? 0;
  const serverRequest = stages.serverRequestMs ?? 0;

  const serverLocal = compile + validation;
  const networkOverhead = Math.max(0, serverRequest - openAi - serverLocal);

  const ranked: Array<{ key: LatencyBottleneck; ms: number }> = [
    { key: "openai" as const, ms: openAi },
    { key: "server_compile_validation" as const, ms: serverLocal },
    { key: "extension_preview" as const, ms: previewApply },
    { key: "extension_context" as const, ms: contextBuild },
    { key: "network" as const, ms: networkOverhead },
  ].sort((left, right) => right.ms - left.ms);

  const top = ranked[0];
  if (!top || top.ms <= 0) {
    return "unknown";
  }

  return top.key;
}

export function finalizeLatencyStages(
  stages: AgentLatencyStages,
  wallClockMs?: number,
): AgentLatencyStages {
  const totalMs =
    typeof wallClockMs === "number" && Number.isFinite(wallClockMs)
      ? wallClockMs
      : sumKnownStageMs(stages);

  return {
    ...stages,
    totalMs,
    bottleneck: identifyLatencyBottleneck(stages),
  };
}

function sumKnownStageMs(stages: AgentLatencyStages): number {
  return (
    (stages.contextBuildMs ?? 0) +
    (stages.serverRequestMs ?? 0) +
    (stages.previewApplyMs ?? 0)
  );
}
