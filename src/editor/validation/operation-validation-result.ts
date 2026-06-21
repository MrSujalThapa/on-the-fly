import type { EditorOperation } from "../operations.js";
import type { ValidationErrorCode } from "./validation-codes.js";
import type { ValidationResult } from "./validate-signature.js";

export interface OperationValidationSuccess {
  ok: true;
  operation: EditorOperation;
}

export interface OperationValidationFailure {
  ok: false;
  errors: string[];
  codes: ValidationErrorCode[];
}

export type OperationValidationResult = OperationValidationSuccess | OperationValidationFailure;

export function createOperationValidationSuccess(
  operation: EditorOperation,
): OperationValidationSuccess {
  return { ok: true, operation };
}

export function createOperationValidationFailure(
  errors: string[],
  codes: ValidationErrorCode[],
): OperationValidationFailure {
  return { ok: false, errors, codes: [...new Set(codes)] };
}

export function validationResultToOperationResult(
  result: ValidationResult,
  operation?: EditorOperation,
): OperationValidationResult {
  if (result.ok && operation) {
    return createOperationValidationSuccess(operation);
  }

  return createOperationValidationFailure(result.errors, result.codes ?? []);
}
