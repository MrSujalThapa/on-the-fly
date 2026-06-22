import type { EditorOperation, EditorOperationType, ResizeMode, StyleProperty } from "../operations.js";
import { isEditorOperationType } from "../operations.js";
import { validateEditorTarget } from "./validate-target.js";
import {
  createValidationFailure,
  createValidationSuccess,
  type ValidationResult,
} from "./validate-signature.js";
import type { ValidationErrorCode } from "./validation-codes.js";

const STYLE_PROPERTIES = new Set<StyleProperty>([
  "color",
  "backgroundColor",
  "borderColor",
  "borderWidth",
  "borderRadius",
  "fontSize",
  "fontWeight",
  "textAlign",
  "opacity",
  "boxShadow",
  "filter",
]);

const RESIZE_MODES = new Set<ResizeMode>(["box", "font-aware", "image"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validateCommonOperationFields(
  operation: EditorOperation,
  errors: string[],
  codes: ValidationErrorCode[],
): void {
  if (!isNonEmptyString(operation.id)) {
    errors.push("operation.id is required");
    codes.push("invalid_shape");
  }

  if (!isNonEmptyString(operation.pageKey)) {
    errors.push("operation.pageKey is required");
    codes.push("invalid_shape");
  }

  if (!isEditorOperationType(operation.type)) {
    errors.push(`operation.type is unknown: ${String(operation.type)}`);
    codes.push("unknown_type");
  }

  if (operation.createdAt <= 0) {
    errors.push("operation.createdAt must be a positive timestamp");
    codes.push("invalid_shape");
  }

  const raw = operation as unknown as Record<string, unknown>;
  if (raw.source !== "manual" && raw.source !== "agent" && raw.source !== "import") {
    errors.push("operation.source is invalid");
    codes.push("invalid_source");
  }

  if (raw.status !== "draft" && raw.status !== "preview" && raw.status !== "approved") {
    errors.push("operation.status is invalid");
    codes.push("invalid_status");
  }

  if (!isRecord(raw.payload)) {
    errors.push("operation.payload must be an object");
    codes.push("invalid_payload");
  }

  const targetResult = validateEditorTarget(operation.target);
  if (!targetResult.ok) {
    errors.push(...targetResult.errors);
    codes.push(...(targetResult.codes ?? []));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePayload(operation: EditorOperation, errors: string[], codes: ValidationErrorCode[]): void {
  if (!isRecord((operation as unknown as Record<string, unknown>).payload)) {
    return;
  }

  switch (operation.type) {
    case "style":
      if (!STYLE_PROPERTIES.has(operation.payload.property)) {
        errors.push("style.property is invalid");
        codes.push("invalid_payload");
      }
      if (!isNonEmptyString(operation.payload.value)) {
        errors.push("style.value is required");
        codes.push("invalid_payload");
      }
      break;
    case "text":
      if (typeof operation.payload.value !== "string") {
        errors.push("text.value must be a string");
        codes.push("invalid_payload");
      }
      if ((operation.payload as { preserveFormat?: unknown }).preserveFormat !== true) {
        errors.push("text.preserveFormat must be true");
        codes.push("invalid_payload");
      }
      break;
    case "move":
      if (!isFiniteNumber(operation.payload.dx) || !isFiniteNumber(operation.payload.dy)) {
        errors.push("move.dx and move.dy must be finite numbers");
        codes.push("invalid_payload");
      }
      break;
    case "resize":
      if (!RESIZE_MODES.has(operation.payload.mode)) {
        errors.push("resize.mode is invalid");
        codes.push("invalid_payload");
      }
      if (
        !isFiniteNumber(operation.payload.width) ||
        !isFiniteNumber(operation.payload.height) ||
        operation.payload.width <= 0 ||
        operation.payload.height <= 0
      ) {
        errors.push("resize.width and resize.height must be positive numbers");
        codes.push("invalid_payload");
      }
      break;
    case "rotate":
      if (!isFiniteNumber(operation.payload.degrees)) {
        errors.push("rotate.degrees must be a finite number");
        codes.push("invalid_payload");
      }
      break;
    case "crop":
      for (const edge of ["top", "right", "bottom", "left"] as const) {
        if (!isFiniteNumber(operation.payload[edge]) || operation.payload[edge] < 0) {
          errors.push(`crop.${edge} must be a non-negative number`);
          codes.push("invalid_payload");
        }
      }
      break;
    case "hide":
      if (typeof operation.payload.hidden !== "boolean") {
        errors.push("hide.hidden must be a boolean");
        codes.push("invalid_payload");
      }
      break;
    case "zIndex":
      if (!Number.isInteger(operation.payload.layer)) {
        errors.push("zIndex.layer must be an integer");
        codes.push("invalid_payload");
      }
      break;
    case "group":
      if (!isNonEmptyString(operation.payload.groupId)) {
        errors.push("group.groupId is required");
        codes.push("invalid_payload");
      }
      if (!isStringArray(operation.payload.memberNodeIds) || operation.payload.memberNodeIds.length === 0) {
        errors.push("group.memberNodeIds must be a non-empty string array");
        codes.push("invalid_payload");
      }
      if (
        !Array.isArray(operation.payload.memberSignatures) ||
        operation.payload.memberSignatures.length !== operation.payload.memberNodeIds.length
      ) {
        errors.push("group.memberSignatures must match memberNodeIds length");
        codes.push("invalid_payload");
      }
      break;
    case "ungroup":
      if (!isNonEmptyString(operation.payload.groupId)) {
        errors.push("ungroup.groupId is required");
        codes.push("invalid_payload");
      }
      break;
    case "insertImage":
      if (!isNonEmptyString(operation.payload.assetId)) {
        errors.push("insertImage.assetId is required");
        codes.push("invalid_payload");
      }
      if (
        !isFiniteNumber(operation.payload.width) ||
        !isFiniteNumber(operation.payload.height) ||
        operation.payload.width <= 0 ||
        operation.payload.height <= 0
      ) {
        errors.push("insertImage.width and insertImage.height must be positive numbers");
        codes.push("invalid_payload");
      }
      if (!isFiniteNumber(operation.payload.x) || !isFiniteNumber(operation.payload.y)) {
        errors.push("insertImage.x and insertImage.y must be finite numbers");
        codes.push("invalid_payload");
      }
      break;
    case "duplicate":
      if (!isNonEmptyString(operation.payload.cloneId)) {
        errors.push("duplicate.cloneId is required");
        codes.push("invalid_payload");
      }
      if (!isNonEmptyString(operation.payload.html)) {
        errors.push("duplicate.html is required");
        codes.push("invalid_payload");
      }
      if (!isNonEmptyString(operation.payload.parentCssPath)) {
        errors.push("duplicate.parentCssPath is required");
        codes.push("invalid_payload");
      }
      if (
        !isFiniteNumber(operation.payload.offsetDx) ||
        !isFiniteNumber(operation.payload.offsetDy)
      ) {
        errors.push("duplicate.offsetDx and duplicate.offsetDy must be finite numbers");
        codes.push("invalid_payload");
      }
      if (
        !isFiniteNumber(operation.payload.anchorLeft) ||
        !isFiniteNumber(operation.payload.anchorTop) ||
        !isFiniteNumber(operation.payload.anchorWidth) ||
        !isFiniteNumber(operation.payload.anchorHeight) ||
        operation.payload.anchorWidth <= 0 ||
        operation.payload.anchorHeight <= 0
      ) {
        errors.push("duplicate anchor geometry must be positive finite numbers");
        codes.push("invalid_payload");
      }
      if (!isRecord(operation.payload.styleSnapshot)) {
        errors.push("duplicate.styleSnapshot must be an object");
        codes.push("invalid_payload");
      }
      break;
  }
}

export function validateOperation(operation: EditorOperation): ValidationResult {
  const errors: string[] = [];
  const codes: ValidationErrorCode[] = [];

  validateCommonOperationFields(operation, errors, codes);
  validatePayload(operation, errors, codes);

  return errors.length === 0
    ? createValidationSuccess()
    : createValidationFailure(errors, [...new Set(codes)]);
}

export function validateOperations(operations: EditorOperation[]): ValidationResult {
  const errors: string[] = [];
  const codes: ValidationErrorCode[] = [];

  operations.forEach((operation, index) => {
    const result = validateOperation(operation);
    if (!result.ok) {
      errors.push(...result.errors.map((error) => `operations[${String(index)}].${error}`));
      codes.push(...(result.codes ?? []));
    }
  });

  return errors.length === 0
    ? createValidationSuccess()
    : createValidationFailure(errors, [...new Set(codes)]);
}

export class OperationValidationError extends Error {
  readonly codes: ValidationErrorCode[];

  constructor(errors: string[], codes: ValidationErrorCode[]) {
    super(errors.join("; "));
    this.name = "OperationValidationError";
    this.codes = codes;
  }
}

export function assertValidOperation(operation: EditorOperation): void {
  const result = validateOperation(operation);
  if (!result.ok) {
    throw new OperationValidationError(result.errors, result.codes ?? []);
  }
}

export type { EditorOperationType };
