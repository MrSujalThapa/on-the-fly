import type { EditorTarget } from "../editor-target.js";
import type { BoundingBoxHint, ElementSignature } from "../element-signature.js";
import { createEmptyBoundingBoxHint } from "../element-signature.js";
import type { EditorOperation, OperationSource, OperationStatus } from "../operations.js";
import { isEditorOperationType } from "../operations.js";
import {
  createOperationValidationFailure,
  createOperationValidationSuccess,
  type OperationValidationResult,
} from "./operation-validation-result.js";
import { validateOperation } from "./validate-operation.js";
import type { ValidationErrorCode } from "./validation-codes.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOperationSource(value: unknown): value is OperationSource {
  return value === "manual" || value === "agent" || value === "import";
}

function isOperationStatus(value: unknown): value is OperationStatus {
  return value === "draft" || value === "preview" || value === "approved";
}

function parseBoundingBoxHint(value: unknown): BoundingBoxHint {
  if (!isRecord(value)) {
    return createEmptyBoundingBoxHint();
  }

  return {
    xRatio: typeof value.xRatio === "number" ? value.xRatio : 0,
    yRatio: typeof value.yRatio === "number" ? value.yRatio : 0,
    widthRatio: typeof value.widthRatio === "number" ? value.widthRatio : 0,
    heightRatio: typeof value.heightRatio === "number" ? value.heightRatio : 0,
  };
}

function parseElementSignature(value: unknown): ElementSignature | null {
  if (!isRecord(value)) {
    return null;
  }

  if (!isNonEmptyString(value.tagName) || !isNonEmptyString(value.cssPath)) {
    return null;
  }

  const signature: ElementSignature = {
    cssPath: value.cssPath,
    tagName: value.tagName,
    classList: Array.isArray(value.classList)
      ? value.classList.filter((entry): entry is string => typeof entry === "string")
      : [],
    boundingBoxHint: parseBoundingBoxHint(value.boundingBoxHint),
  };

  if (typeof value.idAttr === "string") {
    signature.idAttr = value.idAttr;
  }
  if (typeof value.role === "string") {
    signature.role = value.role;
  }
  if (typeof value.ariaLabel === "string") {
    signature.ariaLabel = value.ariaLabel;
  }
  if (typeof value.textFingerprint === "string") {
    signature.textFingerprint = value.textFingerprint;
  }
  if (typeof value.parentFingerprint === "string") {
    signature.parentFingerprint = value.parentFingerprint;
  }
  if (typeof value.parentCssPath === "string") {
    signature.parentCssPath = value.parentCssPath;
  }
  if (typeof value.titleAttr === "string") {
    signature.titleAttr = value.titleAttr;
  }
  if (typeof value.altAttr === "string") {
    signature.altAttr = value.altAttr;
  }
  if (typeof value.srcFingerprint === "string") {
    signature.srcFingerprint = value.srcFingerprint;
  }
  if (typeof value.ancestorTextContext === "string") {
    signature.ancestorTextContext = value.ancestorTextContext;
  }
  if (typeof value.identityVersion === "number") {
    signature.identityVersion = value.identityVersion;
  }
  if (typeof value.siblingOrdinal === "number") {
    signature.siblingOrdinal = value.siblingOrdinal;
  }
  if (typeof value.siblingCount === "number") {
    signature.siblingCount = value.siblingCount;
  }
  if (typeof value.datasetFingerprint === "string") {
    signature.datasetFingerprint = value.datasetFingerprint;
  }
  if (typeof value.hrefAttr === "string") {
    signature.hrefAttr = value.hrefAttr;
  }
  if (typeof value.nameAttr === "string") {
    signature.nameAttr = value.nameAttr;
  }

  return signature;
}

function parseEditorTarget(value: unknown): EditorTarget | null {
  if (!isRecord(value)) {
    return null;
  }

  const target: EditorTarget = {};

  if (typeof value.nodeId === "string") {
    target.nodeId = value.nodeId;
  }
  if (typeof value.groupId === "string") {
    target.groupId = value.groupId;
  }
  if (value.signature !== undefined) {
    const signature = parseElementSignature(value.signature);
    if (!signature) {
      return null;
    }
    target.signature = signature;
  }

  if (!target.nodeId && !target.groupId && !target.signature) {
    return null;
  }

  return target;
}

function buildOperationFromUnknown(
  value: Record<string, unknown>,
  errors: string[],
  codes: ValidationErrorCode[],
): EditorOperation | null {
  if (!isNonEmptyString(value.id)) {
    errors.push("operation.id is required");
    codes.push("invalid_shape");
  }

  if (!isNonEmptyString(value.pageKey)) {
    errors.push("operation.pageKey is required");
    codes.push("invalid_shape");
  }

  const typeValue = value.type;
  if (typeof typeValue !== "string" || !isEditorOperationType(typeValue)) {
    errors.push(`operation.type is unknown: ${String(typeValue)}`);
    codes.push("unknown_type");
    return null;
  }

  if (typeof value.createdAt !== "number" || value.createdAt <= 0) {
    errors.push("operation.createdAt must be a positive timestamp");
    codes.push("invalid_shape");
  }

  if (!isOperationSource(value.source)) {
    errors.push("operation.source is invalid");
    codes.push("invalid_source");
  }

  if (!isOperationStatus(value.status)) {
    errors.push("operation.status is invalid");
    codes.push("invalid_status");
  }

  if (!isRecord(value.payload)) {
    errors.push("operation.payload must be an object");
    codes.push("invalid_payload");
    return null;
  }

  const target = parseEditorTarget(value.target);
  if (!target) {
    errors.push("operation.target is missing or invalid");
    codes.push("missing_target");
    return null;
  }

  if (errors.length > 0) {
    return null;
  }

  return {
    id: value.id as string,
    type: typeValue,
    pageKey: value.pageKey as string,
    target,
    payload: value.payload as EditorOperation["payload"],
    createdAt: value.createdAt as number,
    source: value.source as OperationSource,
    status: value.status as OperationStatus,
  } as EditorOperation;
}

export function validateUnknownOperation(value: unknown): OperationValidationResult {
  if (!isRecord(value)) {
    return createOperationValidationFailure(["operation must be an object"], ["invalid_shape"]);
  }

  const errors: string[] = [];
  const codes: ValidationErrorCode[] = [];
  const operation = buildOperationFromUnknown(value, errors, codes);

  if (!operation) {
    return createOperationValidationFailure(errors, codes);
  }

  const validated = validateOperation(operation);
  if (!validated.ok) {
    return createOperationValidationFailure(validated.errors, validated.codes ?? codes);
  }

  return createOperationValidationSuccess(operation);
}

export function validateUnknownOperations(values: unknown[]): OperationValidationResult[] {
  return values.map((value) => validateUnknownOperation(value));
}
