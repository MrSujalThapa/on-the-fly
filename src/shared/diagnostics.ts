import { buildFlags } from "./build-flags.js";

export type DiagnosticLogger = (message: string, data?: unknown) => void;

/**
 * Runtime state of the diagnostic channel. Seeded from the build flag so a
 * diagnostics build is loud from the first event and a public build starts —
 * and, with no production caller of `setDiagnosticsEnabled`, stays — silent.
 */
let enabled = buildFlags.diagnosticsEnabled;

export function areDiagnosticsEnabled(): boolean {
  return enabled;
}

/** Local investigation / test switch. Not called from any production path. */
export function setDiagnosticsEnabled(next: boolean): void {
  enabled = next;
}

/**
 * The one development-only sink every diagnostic event reaches. Local console
 * only: no storage, no network, no telemetry.
 */
export function emitDiagnostic(message: string, data?: unknown): void {
  if (!enabled) {
    return;
  }

  try {
    if (data === undefined) {
      console.debug(`[OTF] ${message}`);
      return;
    }
    console.debug(`[OTF] ${message}`, data);
  } catch {
    // Reporting a diagnostic must never change editor behaviour.
  }
}
