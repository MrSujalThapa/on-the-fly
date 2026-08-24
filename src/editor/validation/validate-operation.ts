import { isCreatedElementKind } from "../create/created-element.js";
import {
  formatAllowedHelperRoles,
  isHelperObjectRole,
} from "../helper-object-contract.js";
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
    "backgroundImage",
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
const HELPER_BORDER_STYLES = new Set(["solid", "dashed", "dotted"]);
const HELPER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const LENGTH_PATTERN = /^(?:0|-?\d+(?:\.\d+)?(?:px|rem|em|%)?)$/;
const SAFE_COLOR_PATTERN =
  /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|hsla?\(\s*-?\d+(?:\.\d+)?(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|transparent|currentColor|black|white|gray|grey|red|green|blue|yellow|orange|purple|pink|teal|cyan|indigo|slate|zinc|neutral|stone)$/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isSafeColor(value: unknown): value is string {
  return typeof value === "string" && SAFE_COLOR_PATTERN.test(value.trim());
}

function isSafeCssLength(value: unknown): value is string {
  return typeof value === "string" && LENGTH_PATTERN.test(value.trim());
}

function validateHelperFill(fill: unknown, errors: string[], codes: ValidationErrorCode[]): void {
  if (!isRecord(fill)) {
    errors.push("insertHelperObject.fill must be an object");
    codes.push("invalid_payload");
    return;
  }

  if (fill.type === "solid") {
    if (!isSafeColor(fill.color)) {
      errors.push("insertHelperObject.fill.color must be a safe color");
      codes.push("invalid_payload");
    }
    return;
  }

  if (fill.type === "linearGradient") {
    if (!isFiniteNumber(fill.angleDeg)) {
      errors.push("insertHelperObject.fill.angleDeg must be a finite number");
      codes.push("invalid_payload");
    }
    if (!Array.isArray(fill.stops) || fill.stops.length < 2 || fill.stops.length > 5) {
      errors.push("insertHelperObject.fill.stops must include 2-5 stops");
      codes.push("invalid_payload");
      return;
    }
    for (const stop of fill.stops) {
      if (!isRecord(stop) || !isSafeColor(stop.color) || !isFiniteNumber(stop.position)) {
        errors.push("insertHelperObject.fill.stops entries must include safe color and finite position");
        codes.push("invalid_payload");
        continue;
      }
      if (stop.position < 0 || stop.position > 100) {
        errors.push("insertHelperObject.fill.stops position must be between 0 and 100");
        codes.push("invalid_payload");
      }
    }
    return;
  }

  errors.push("insertHelperObject.fill.type is invalid");
  codes.push("invalid_payload");
}

function validateHelperBoxShadow(
  boxShadow: unknown,
  errors: string[],
  codes: ValidationErrorCode[],
): void {
  if (!isRecord(boxShadow)) {
    errors.push("insertHelperObject.boxShadow must be an object");
    codes.push("invalid_payload");
    return;
  }

  for (const key of ["offsetX", "offsetY", "blurRadius"] as const) {
    if (!isFiniteNumber(boxShadow[key])) {
      errors.push(`insertHelperObject.boxShadow.${key} must be finite`);
      codes.push("invalid_payload");
    }
  }
  if (boxShadow.spreadRadius !== undefined && !isFiniteNumber(boxShadow.spreadRadius)) {
    errors.push("insertHelperObject.boxShadow.spreadRadius must be finite");
    codes.push("invalid_payload");
  }
  if (!isSafeColor(boxShadow.color)) {
    errors.push("insertHelperObject.boxShadow.color must be a safe color");
    codes.push("invalid_payload");
  }
}

function validateHelperBorder(border: unknown, errors: string[], codes: ValidationErrorCode[]): void {
  if (!isRecord(border)) {
    errors.push("insertHelperObject.border must be an object");
    codes.push("invalid_payload");
    return;
  }

  if (!isFiniteNumber(border.width) || border.width < 0) {
    errors.push("insertHelperObject.border.width must be a non-negative number");
    codes.push("invalid_payload");
  }
  if (!isSafeColor(border.color)) {
    errors.push("insertHelperObject.border.color must be a safe color");
    codes.push("invalid_payload");
  }
  if (!HELPER_BORDER_STYLES.has(String(border.style))) {
    errors.push("insertHelperObject.border.style is invalid");
    codes.push("invalid_payload");
  }
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
    case "insertHelperObject":
      if (!isNonEmptyString(operation.payload.helperId) || !HELPER_ID_PATTERN.test(operation.payload.helperId)) {
        errors.push("insertHelperObject.helperId is invalid");
        codes.push("invalid_payload");
      }
      if (!isHelperObjectRole(operation.payload.role)) {
        const got =
          typeof operation.payload.role === "string"
            ? operation.payload.role
            : String(operation.payload.role);
        errors.push(
          `insertHelperObject.role is invalid (got "${got}", allowed: ${formatAllowedHelperRoles()})`,
        );
        codes.push("invalid_payload");
      }
      if (!isRecord(operation.payload.rect)) {
        errors.push("insertHelperObject.rect must be an object");
        codes.push("invalid_payload");
      } else {
        for (const key of ["x", "y", "width", "height"] as const) {
          if (!isFiniteNumber(operation.payload.rect[key])) {
            errors.push(`insertHelperObject.rect.${key} must be finite`);
            codes.push("invalid_payload");
          }
        }
        if (operation.payload.rect.width <= 0 || operation.payload.rect.height <= 0) {
          errors.push("insertHelperObject.rect width and height must be positive");
          codes.push("invalid_payload");
        }
      }
      if (operation.payload.fill !== undefined) {
        validateHelperFill(operation.payload.fill, errors, codes);
      }
      if (operation.payload.borderRadius !== undefined && !isSafeCssLength(operation.payload.borderRadius)) {
        errors.push("insertHelperObject.borderRadius must be a safe length");
        codes.push("invalid_payload");
      }
      if (
        operation.payload.opacity !== undefined &&
        (!isFiniteNumber(operation.payload.opacity) ||
          operation.payload.opacity < 0 ||
          operation.payload.opacity > 1)
      ) {
        errors.push("insertHelperObject.opacity must be between 0 and 1");
        codes.push("invalid_payload");
      }
      if (operation.payload.boxShadow !== undefined) {
        validateHelperBoxShadow(operation.payload.boxShadow, errors, codes);
      }
      if (operation.payload.zIndex !== undefined && !Number.isInteger(operation.payload.zIndex)) {
        errors.push("insertHelperObject.zIndex must be an integer");
        codes.push("invalid_payload");
      }
      if (operation.payload.border !== undefined) {
        validateHelperBorder(operation.payload.border, errors, codes);
      }
      if (operation.payload.label !== undefined && typeof operation.payload.label !== "string") {
        errors.push("insertHelperObject.label must be a string");
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
    case "createElement":
      if (!isNonEmptyString(operation.payload.elementId)) {
        errors.push("createElement.elementId is required");
        codes.push("invalid_payload");
      }
      if (!isCreatedElementKind(operation.payload.kind)) {
        errors.push("createElement.kind is invalid");
        codes.push("invalid_payload");
      }
      if (!isRecord(operation.payload.rect) ||
        !isFiniteNumber(operation.payload.rect.x) ||
        !isFiniteNumber(operation.payload.rect.y) ||
        !isFiniteNumber(operation.payload.rect.width) ||
        !isFiniteNumber(operation.payload.rect.height) ||
        operation.payload.rect.width <= 0 ||
        operation.payload.rect.height <= 0
      ) {
        errors.push("createElement.rect must be a positive geometry");
        codes.push("invalid_payload");
      }
      if (!isRecord(operation.payload.content) || !isRecord(operation.payload.appearance)) {
        errors.push("createElement.content and appearance must be objects");
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
