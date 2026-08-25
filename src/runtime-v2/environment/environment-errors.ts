export const ENVIRONMENT_ERROR_CODES = [
  "ELEMENT_NOT_FOUND",
  "ELEMENT_AMBIGUOUS",
  "ELEMENT_STALE",
  "UNSUPPORTED_OPERATION",
  "INVALID_OPERATION",
  "VERIFICATION_FAILED",
  "ROLLBACK_FAILED",
  "INTERNAL_ERROR",
] as const;

export type EnvironmentErrorCode = (typeof ENVIRONMENT_ERROR_CODES)[number];

export interface EnvironmentError {
  readonly code: EnvironmentErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function environmentError(
  code: EnvironmentErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): EnvironmentError {
  return details ? { code, message, details } : { code, message };
}

export class OTFEnvironmentError extends Error {
  readonly code: EnvironmentErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(error: EnvironmentError) {
    super(error.message);
    this.name = "OTFEnvironmentError";
    this.code = error.code;
    if (error.details) this.details = error.details;
  }
}

export function throwEnvironment(error: EnvironmentError): never {
  throw new OTFEnvironmentError(error);
}

export function errorFromExecutor(error: string): EnvironmentError {
  if (error === "ambiguous_target") {
    return environmentError("ELEMENT_AMBIGUOUS", error);
  }
  if (error === "unresolved_target" || error === "unknown_node") {
    return environmentError("ELEMENT_NOT_FOUND", error);
  }
  if (error === "missing_identity" || error === "identity_uncertain" || error === "duplicate_live_element") {
    return environmentError("ELEMENT_STALE", error);
  }
  if (error === "geometry_mismatch" || error.startsWith("layer_verification")) {
    return environmentError("VERIFICATION_FAILED", error);
  }
  if (error.includes("invalid") || error.includes("empty_") || error.endsWith("_unresolved") || error.endsWith("_unsafe")) {
    return environmentError("INVALID_OPERATION", error);
  }
  if (error.includes("unsupported") || error.startsWith("batch_not_atomic")) {
    return environmentError("UNSUPPORTED_OPERATION", error);
  }
  return environmentError("INTERNAL_ERROR", error);
}
