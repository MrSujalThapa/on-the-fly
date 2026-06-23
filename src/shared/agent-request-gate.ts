export interface AgentAvailabilityFlags {
  publicAgentEnabled: boolean;
  localDevAgentEnabled: boolean;
}

export function canExtensionCallLocalAgent(flags: AgentAvailabilityFlags): boolean {
  return flags.localDevAgentEnabled && !flags.publicAgentEnabled;
}

export function resolveLocalAgentBaseUrl(configuredUrl: string | undefined): string {
  const trimmed = configuredUrl?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "http://127.0.0.1:4317";
}
