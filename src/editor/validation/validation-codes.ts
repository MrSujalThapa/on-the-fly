export type ValidationErrorCode =
  | "invalid_shape"
  | "unknown_type"
  | "missing_target"
  | "dangerous_selector"
  | "invalid_payload"
  | "invalid_signature"
  | "unsupported_dom_operation"
  | "invalid_status"
  | "invalid_source"
  | "out_of_scope";

export type DomErrorCode =
  | "validation_failed"
  | "unsupported_dom_operation"
  | "target_not_found"
  | "target_signature_mismatch"
  | "operation_already_applied"
  | "operation_not_applied"
  | "dom_apply_failed"
  | "dom_revert_failed";

export const SUPPORTED_DOM_OPERATION_TYPES = [
  "style",
  "text",
  "hide",
  "crop",
  "zIndex",
  "move",
  "resize",
  "rotate",
  "insertHelperObject",
  "duplicate",
] as const;

export type SupportedDomOperationType = (typeof SUPPORTED_DOM_OPERATION_TYPES)[number];

export function isSupportedDomOperationType(
  value: string,
): value is SupportedDomOperationType {
  return (SUPPORTED_DOM_OPERATION_TYPES as readonly string[]).includes(value);
}

export function inferValidationErrorCodes(errors: string[]): ValidationErrorCode[] {
  const codes = new Set<ValidationErrorCode>();

  for (const error of errors) {
    if (error.includes("unknown") || error.includes("operation.type")) {
      codes.add("unknown_type");
    }
    if (error.includes("dangerous") || error.includes("page-level")) {
      codes.add("dangerous_selector");
    }
    if (error.includes("target must include") || error.includes("target.signature is required")) {
      codes.add("missing_target");
    }
    if (error.includes("signature.")) {
      codes.add("invalid_signature");
    }
    if (
      error.includes(".payload") ||
      error.includes("payload must") ||
      error.startsWith("style.") ||
      error.startsWith("move.") ||
      error.startsWith("text.") ||
      error.startsWith("rotate.") ||
      error.startsWith("hide.") ||
      error.startsWith("zIndex.") ||
      error.startsWith("group.") ||
      error.startsWith("crop.") ||
      error.startsWith("insertImage.") ||
      error.startsWith("insertHelperObject.") ||
      error.startsWith("duplicate.") ||
      error.startsWith("resize.")
    ) {
      codes.add("invalid_payload");
    }
    if (error.includes("operation.source")) {
      codes.add("invalid_source");
    }
    if (error.includes("operation.status")) {
      codes.add("invalid_status");
    }
    if (error.includes("unsupported_dom_operation")) {
      codes.add("unsupported_dom_operation");
    }
    if (error.includes("operation must be an object") || error.includes("operation.id")) {
      codes.add("invalid_shape");
    }
  }

  if (codes.size === 0) {
    codes.add("invalid_shape");
  }

  return [...codes];
}
