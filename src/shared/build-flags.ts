export interface BuildFlags {
  readonly publicAgentEnabled: boolean;
  readonly publicBackendEnabled: boolean;
  readonly localAgentServerUrl: string | undefined;
}

export const buildFlags: BuildFlags = {
  publicAgentEnabled: __PUBLIC_AGENT_ENABLED__,
  publicBackendEnabled: __PUBLIC_BACKEND_ENABLED__,
  localAgentServerUrl: __LOCAL_AGENT_SERVER_URL__ || undefined,
};

export function isAgentEnabled(): boolean {
  return buildFlags.publicAgentEnabled;
}

export function isBackendEnabled(): boolean {
  return buildFlags.publicBackendEnabled;
}
