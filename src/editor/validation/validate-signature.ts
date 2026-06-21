import type { BoundingBoxHint, ElementSignature } from "../element-signature.js";
import { isDangerousCssPath, isDangerousTagName } from "./dangerous-selectors.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function createValidationSuccess(): ValidationResult {
  return { ok: true, errors: [] };
}

export function createValidationFailure(errors: string[]): ValidationResult {
  return { ok: false, errors };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateBoundingBoxHint(hint: BoundingBoxHint, errors: string[]): void {
  if (!isFiniteNumber(hint.xRatio) || hint.xRatio < 0 || hint.xRatio > 1) {
    errors.push("signature.boundingBoxHint.xRatio must be between 0 and 1");
  }

  if (!isFiniteNumber(hint.yRatio) || hint.yRatio < 0 || hint.yRatio > 1) {
    errors.push("signature.boundingBoxHint.yRatio must be between 0 and 1");
  }

  if (!isFiniteNumber(hint.widthRatio) || hint.widthRatio < 0 || hint.widthRatio > 1) {
    errors.push("signature.boundingBoxHint.widthRatio must be between 0 and 1");
  }

  if (!isFiniteNumber(hint.heightRatio) || hint.heightRatio < 0 || hint.heightRatio > 1) {
    errors.push("signature.boundingBoxHint.heightRatio must be between 0 and 1");
  }
}

export function validateElementSignature(signature: ElementSignature): ValidationResult {
  const errors: string[] = [];

  if (!signature.tagName.trim()) {
    errors.push("signature.tagName is required");
  } else if (isDangerousTagName(signature.tagName)) {
    errors.push("signature.tagName cannot target page-level nodes");
  }

  if (isDangerousCssPath(signature.cssPath)) {
    errors.push("signature.cssPath is missing or targets a dangerous selector");
  }

  if (!Array.isArray(signature.classList)) {
    errors.push("signature.classList must be an array");
  }

  validateBoundingBoxHint(signature.boundingBoxHint, errors);

  return errors.length === 0 ? createValidationSuccess() : createValidationFailure(errors);
}
