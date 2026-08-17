export interface BuildFlags {
  readonly publicAgentEnabled: boolean;
  readonly publicBackendEnabled: boolean;
  readonly localDevAgentEnabled: boolean;
  readonly localAgentServerUrl: string | undefined;
  readonly diagnosticsEnabled: boolean;
}

export const buildFlags: BuildFlags = {
  publicAgentEnabled: __PUBLIC_AGENT_ENABLED__,
  publicBackendEnabled: __PUBLIC_BACKEND_ENABLED__,
  localDevAgentEnabled: __LOCAL_DEV_AGENT_ENABLED__,
  localAgentServerUrl: __LOCAL_AGENT_SERVER_URL__ || undefined,
  diagnosticsEnabled: __OTF_DIAGNOSTICS_ENABLED__,
};

export function isLocalAgentAvailable(): boolean {
  return buildFlags.localDevAgentEnabled && !buildFlags.publicAgentEnabled;
}

/** @deprecated Use isLocalAgentAvailable for local-dev agent workflows. */
export function isAgentEnabled(): boolean {
  return isLocalAgentAvailable();
}

export function isBackendEnabled(): boolean {
  return buildFlags.publicBackendEnabled;
}

export function getLocalAgentServerUrl(): string {
  const configured = buildFlags.localAgentServerUrl?.trim();
  return configured && configured.length > 0 ? configured : "http://127.0.0.1:4317";
}
