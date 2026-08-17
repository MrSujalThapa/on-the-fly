import { emitDiagnostic } from "../../shared/diagnostics.js";

/**
 * Default sink for every `onDebug` producer in the content layer. Enabled by the
 * `OTF_DIAGNOSTICS=true` build; a no-op everywhere else.
 */
export function logSelectionDebug(message: string, data?: unknown): void {
  emitDiagnostic(message, data);
}
