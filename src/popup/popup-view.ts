export function formatAgentStatus(agentEnabled: boolean): string {
  return agentEnabled ? "Agent enabled" : "Agent disabled";
}

export function formatSavedOpsCount(count: number | null): string {
  return count === null ? "Saved ops: -" : `Saved ops: ${String(count)}`;
}

export function formatSavedOpsDisplayCount(count: number | null): string {
  return count === null ? "-" : String(count);
}

export function formatPopupDiagnostics(options: {
  operationCount: number | null;
  agentEnabled: boolean;
}): string {
  return `${formatSavedOpsCount(options.operationCount)} | ${formatAgentStatus(options.agentEnabled)}`;
}
