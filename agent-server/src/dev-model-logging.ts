import { isHelperObjectRole } from "../../src/editor/helper-object-contract.js";

interface SanitizedOperationLog {
  index: number;
  type?: string;
  target?: {
    nodeId?: string;
    groupId?: string;
    hasSignature: boolean;
    signatureCssPath?: string;
  };
  helperRole?: string;
  helperId?: string;
  rect?: { x: number; y: number; width: number; height: number };
  fillType?: string;
}

export function logSanitizedModelOutput(
  requestId: string,
  raw: unknown,
  validationErrors?: string[],
): void {
  const payload = {
    requestId,
    operationCount: extractOperationCount(raw),
    operations: sanitizeOperations(raw),
    ...(validationErrors && validationErrors.length > 0
      ? { validationErrors: validationErrors.slice(0, 20) }
      : {}),
  };

  console.log(`[on-the-fly-agent] requestId=${requestId} event=model_output ${JSON.stringify(payload)}`);
}

function extractOperationCount(raw: unknown): number {
  if (!isRecord(raw) || !Array.isArray(raw.draftOperations)) {
    return 0;
  }
  return raw.draftOperations.length;
}

function sanitizeOperations(raw: unknown): SanitizedOperationLog[] {
  if (!isRecord(raw) || !Array.isArray(raw.draftOperations)) {
    return [];
  }

  return raw.draftOperations.slice(0, 12).map((entry, index) => sanitizeOperation(entry, index));
}

function sanitizeOperation(value: unknown, index: number): SanitizedOperationLog {
  if (!isRecord(value)) {
    return { index, type: "unknown" };
  }

  const log: SanitizedOperationLog = {
    index,
    type: typeof value.type === "string" ? value.type : "unknown",
  };

  if (isRecord(value.target)) {
    log.target = {
      ...(typeof value.target.nodeId === "string" ? { nodeId: value.target.nodeId } : {}),
      ...(typeof value.target.groupId === "string" ? { groupId: value.target.groupId } : {}),
      hasSignature: isRecord(value.target.signature),
      ...(isRecord(value.target.signature) && typeof value.target.signature.cssPath === "string"
        ? { signatureCssPath: value.target.signature.cssPath.slice(0, 120) }
        : {}),
    };
  }

  if (isRecord(value.payload)) {
    if (typeof value.payload.helperId === "string") {
      log.helperId = value.payload.helperId.slice(0, 80);
    }
    if (typeof value.payload.role === "string") {
      log.helperRole = value.payload.role;
      if (!isHelperObjectRole(value.payload.role)) {
        log.helperRole = `${value.payload.role} (invalid)`;
      }
    }
    if (isRecord(value.payload.rect)) {
      const rect = readRect(value.payload.rect);
      if (rect) {
        log.rect = rect;
      }
    }
    if (isRecord(value.payload.fill) && typeof value.payload.fill.type === "string") {
      log.fillType = value.payload.fill.type;
    }
  }

  return log;
}

function readRect(value: Record<string, unknown>): SanitizedOperationLog["rect"] | undefined {
  const { x, y, width, height } = value;
  if (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof width === "number" &&
    typeof height === "number" &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height)
  ) {
    return { x, y, width, height };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
