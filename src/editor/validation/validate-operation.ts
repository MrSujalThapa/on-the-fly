import type { EditorOperation, EditorOperationType } from "../operations.js";
import { isEditorOperationType } from "../operations.js";
import { validateEditorTarget } from "./validate-target.js";
import {
  createValidationFailure,
  createValidationSuccess,
  type ValidationResult,
} from "./validate-signature.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateCommonOperationFields(operation: EditorOperation, errors: string[]): void {
  if (!isNonEmptyString(operation.id)) {
    errors.push("operation.id is required");
  }

  if (!isNonEmptyString(operation.pageKey)) {
    errors.push("operation.pageKey is required");
  }

  if (!isEditorOperationType(operation.type)) {
    errors.push(`operation.type is unknown: ${String(operation.type)}`);
  }

  if (operation.createdAt <= 0) {
    errors.push("operation.createdAt must be a positive timestamp");
  }

  const targetResult = validateEditorTarget(operation.target);
  if (!targetResult.ok) {
    errors.push(...targetResult.errors);
  }
}

function validatePayload(operation: EditorOperation, errors: string[]): void {
  switch (operation.type) {
    case "style":
      if (!isNonEmptyString(operation.payload.value)) {
        errors.push("style.value is required");
      }
      break;
    case "text":
      if (typeof operation.payload.value !== "string") {
        errors.push("text.value must be a string");
      }
      break;
    case "move":
      if (!isFiniteNumber(operation.payload.dx) || !isFiniteNumber(operation.payload.dy)) {
        errors.push("move.dx and move.dy must be finite numbers");
      }
      break;
    case "resize":
      if (
        !isFiniteNumber(operation.payload.width) ||
        !isFiniteNumber(operation.payload.height) ||
        operation.payload.width <= 0 ||
        operation.payload.height <= 0
      ) {
        errors.push("resize.width and resize.height must be positive numbers");
      }
      break;
    case "rotate":
      if (!isFiniteNumber(operation.payload.degrees)) {
        errors.push("rotate.degrees must be a finite number");
      }
      break;
    case "crop":
      for (const edge of ["top", "right", "bottom", "left"] as const) {
        if (!isFiniteNumber(operation.payload[edge]) || operation.payload[edge] < 0) {
          errors.push(`crop.${edge} must be a non-negative number`);
        }
      }
      break;
    case "hide":
      if (typeof operation.payload.hidden !== "boolean") {
        errors.push("hide.hidden must be a boolean");
      }
      break;
    case "zIndex":
      if (!Number.isInteger(operation.payload.layer)) {
        errors.push("zIndex.layer must be an integer");
      }
      break;
    case "group":
      if (!isNonEmptyString(operation.payload.groupId)) {
        errors.push("group.groupId is required");
      }
      if (operation.payload.memberNodeIds.length === 0) {
        errors.push("group.memberNodeIds must not be empty");
      }
      if (operation.payload.memberSignatures.length !== operation.payload.memberNodeIds.length) {
        errors.push("group.memberSignatures must match memberNodeIds length");
      }
      break;
    case "ungroup":
      if (!isNonEmptyString(operation.payload.groupId)) {
        errors.push("ungroup.groupId is required");
      }
      break;
    case "insertImage":
      if (!isNonEmptyString(operation.payload.assetId)) {
        errors.push("insertImage.assetId is required");
      }
      if (
        !isFiniteNumber(operation.payload.width) ||
        !isFiniteNumber(operation.payload.height) ||
        operation.payload.width <= 0 ||
        operation.payload.height <= 0
      ) {
        errors.push("insertImage.width and insertImage.height must be positive numbers");
      }
      if (!isFiniteNumber(operation.payload.x) || !isFiniteNumber(operation.payload.y)) {
        errors.push("insertImage.x and insertImage.y must be finite numbers");
      }
      break;
  }
}

export function validateOperation(operation: EditorOperation): ValidationResult {
  const errors: string[] = [];
  validateCommonOperationFields(operation, errors);
  validatePayload(operation, errors);
  return errors.length === 0 ? createValidationSuccess() : createValidationFailure(errors);
}

export function validateOperations(operations: EditorOperation[]): ValidationResult {
  const errors: string[] = [];

  operations.forEach((operation, index) => {
    const result = validateOperation(operation);
    if (!result.ok) {
      errors.push(...result.errors.map((error) => `operations[${String(index)}].${error}`));
    }
  });

  return errors.length === 0 ? createValidationSuccess() : createValidationFailure(errors);
}

export function assertValidOperation(operation: EditorOperation): void {
  const result = validateOperation(operation);
  if (!result.ok) {
    throw new Error(result.errors.join("; "));
  }
}

export type { EditorOperationType };
