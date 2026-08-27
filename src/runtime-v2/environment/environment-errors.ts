export const ENVIRONMENT_ERROR_CODES = [
  "ELEMENT_NOT_FOUND",
  "ELEMENT_AMBIGUOUS",
  "ELEMENT_STALE",
  "UNSUPPORTED_OPERATION",
  "INVALID_OPERATION",
  "VERIFICATION_FAILED",
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
