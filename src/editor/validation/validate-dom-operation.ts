import type { EditorOperation } from "../operations.js";
import {
  createOperationValidationFailure,
  createOperationValidationSuccess,
  type OperationValidationResult,
} from "./operation-validation-result.js";
import { validateOperation } from "./validate-operation.js";
import { isSupportedDomOperationType } from "./validation-codes.js";

export function validateOperationForDom(operation: EditorOperation): OperationValidationResult {
  const base = validateOperation(operation);
  if (!base.ok) {
    return createOperationValidationFailure(base.errors, base.codes ?? []);
  }

  if (!isSupportedDomOperationType(operation.type)) {
    return createOperationValidationFailure(
      [`unsupported_dom_operation:${operation.type}`],
      ["unsupported_dom_operation"],
    );
  }

  if (!operation.target.signature) {
    return createOperationValidationFailure(
      ["target.signature is required for dom operations"],
      ["missing_target"],
    );
  }

  return createOperationValidationSuccess(operation);
}

export function validateOperationsForDom(operations: EditorOperation[]): OperationValidationResult[] {
  return operations.map((operation) => validateOperationForDom(operation));
}
