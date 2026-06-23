import type { AgentEditRequest } from "../../shared/agent-contracts.js";
import { createEmptyBoundingBoxHint } from "../element-signature.js";
import type { EditorTarget } from "../editor-target.js";
import type { AgentScopeRect } from "../validation/validate-agent-scope.js";

const HELPER_PADDING_PX = 24;
const MIN_HELPER_SIZE_PX = 40;

export interface HelperObjectNormalizationResult {
  ok: true;
  operation: Record<string, unknown>;
}

export interface HelperObjectNormalizationFailure {
  ok: false;
  error: string;
}

export type NormalizeHelperObjectResult =
  | HelperObjectNormalizationResult
  | HelperObjectNormalizationFailure;

export function normalizeInsertHelperObjectForAgentRequest(
  operation: Record<string, unknown>,
  request: AgentEditRequest,
  index: number,
): NormalizeHelperObjectResult {
  if (operation.type !== "insertHelperObject") {
    return { ok: true, operation };
  }

  if (request.selectedNodes.length === 0) {
    return {
      ok: false,
      error: `operations[${String(index)}] cannot resolve helper object target without selected scope`,
    };
  }

  const payload = isRecord(operation.payload) ? { ...operation.payload } : {};
  const helperId = resolveHelperId(payload, operation, request, index);
  payload.helperId = helperId;

  const bounds = computeSelectionBounds(request.selectedNodes);
  const rectResult = resolveHelperRect(payload.rect, bounds);
  if (!rectResult.ok) {
    return {
      ok: false,
      error: `operations[${String(index)}] ${rectResult.error}`,
    };
  }
  payload.rect = rectResult.rect;

  const target = buildHelperObjectTarget(helperId, request);
  const normalized: Record<string, unknown> = {
    ...operation,
    payload,
    target,
  };

  return { ok: true, operation: normalized };
}

export function prepareAgentDraftOperations(
  operations: unknown[],
  request: AgentEditRequest,
): { ok: true; operations: Record<string, unknown>[] } | { ok: false; errors: string[] } {
  const prepared = operations.map((entry, index) => normalizeAgentOperationBase(entry, request, index));
  return normalizeAgentDraftOperations(prepared, request);
}

function normalizeAgentOperationBase(
  value: unknown,
  request: AgentEditRequest,
  index: number,
): Record<string, unknown> {
  const operation = isRecord(value) ? { ...value } : {};
  const now = Date.now();

  operation.pageKey = request.pageKey;
  operation.source = "agent";
  operation.status = operation.status === "draft" ? "draft" : "preview";
  operation.id =
    typeof operation.id === "string" && operation.id.trim().length > 0
      ? operation.id
      : `agent-op-${String(now)}-${String(index)}`;
  operation.createdAt =
    typeof operation.createdAt === "number" && Number.isFinite(operation.createdAt)
      ? operation.createdAt
      : now;

  return operation;
}

export function normalizeAgentDraftOperations(
  operations: unknown[],
  request: AgentEditRequest,
): { ok: true; operations: Record<string, unknown>[] } | { ok: false; errors: string[] } {
  const normalized: Record<string, unknown>[] = [];
  const errors: string[] = [];

  operations.forEach((entry, index) => {
    const operation = isRecord(entry) ? { ...entry } : {};
    if (operation.type !== "insertHelperObject") {
      normalized.push(operation);
      return;
    }

    const result = normalizeInsertHelperObjectForAgentRequest(operation, request, index);
    if (!result.ok) {
      errors.push(result.error);
      return;
    }
    normalized.push(result.operation);
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, operations: normalized };
}

function buildHelperObjectTarget(helperId: string, request: AgentEditRequest): EditorTarget {
  const elementId = `otf-helper-${helperId}`;
  const target: EditorTarget = {
    nodeId: helperId,
    signature: {
      cssPath: `#${elementId}`,
      tagName: "div",
      classList: ["otf-helper-object"],
      idAttr: elementId,
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
  };

  if (request.selection.activeGroupId) {
    target.groupId = request.selection.activeGroupId;
  }

  return target;
}

function resolveHelperId(
  payload: Record<string, unknown>,
  operation: Record<string, unknown>,
  request: AgentEditRequest,
  index: number,
): string {
  const candidates = [
    payload.helperId,
    isRecord(operation.target) ? operation.target.nodeId : undefined,
    isRecord(operation.target) ? operation.target.helperId : undefined,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const sanitized = sanitizeHelperId(candidate);
      if (sanitized.length > 0) {
        return sanitized;
      }
    }
  }

  const scopeKey = request.selection.activeGroupId
    ? request.selection.activeGroupId
    : [...request.selection.selectedNodeIds].sort().join("-") || "selection";
  return sanitizeHelperId(`agent-${scopeKey}-${String(Date.now())}-${String(index)}`);
}

function resolveHelperRect(
  value: unknown,
  bounds: AgentScopeRect,
): { ok: true; rect: AgentScopeRect } | { ok: false; error: string } {
  const candidate = readRect(value);
  if (candidate) {
    if (candidate.width <= 0 || candidate.height <= 0) {
      return { ok: false, error: "helper rect has zero or negative dimensions" };
    }
    return { ok: true, rect: expandRectToCoverBounds(candidate, bounds) };
  }

  return {
    ok: true,
    rect: {
      x: Math.max(0, bounds.x - HELPER_PADDING_PX),
      y: Math.max(0, bounds.y - HELPER_PADDING_PX),
      width: Math.max(MIN_HELPER_SIZE_PX, bounds.width + HELPER_PADDING_PX * 2),
      height: Math.max(MIN_HELPER_SIZE_PX, bounds.height + HELPER_PADDING_PX * 2),
    },
  };
}

function expandRectToCoverBounds(rect: AgentScopeRect, bounds: AgentScopeRect): AgentScopeRect {
  const padded = {
    x: Math.max(0, bounds.x - HELPER_PADDING_PX),
    y: Math.max(0, bounds.y - HELPER_PADDING_PX),
    width: Math.max(MIN_HELPER_SIZE_PX, bounds.width + HELPER_PADDING_PX * 2),
    height: Math.max(MIN_HELPER_SIZE_PX, bounds.height + HELPER_PADDING_PX * 2),
  };

  return {
    x: Math.min(rect.x, padded.x),
    y: Math.min(rect.y, padded.y),
    width: Math.max(rect.width, padded.width),
    height: Math.max(rect.height, padded.height),
  };
}

function sanitizeHelperId(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 64);
  return sanitized.length > 0 ? sanitized : "helper-panel";
}

function readRect(value: unknown): AgentScopeRect | null {
  if (!isRecord(value)) {
    return null;
  }

  const x = value.x;
  const y = value.y;
  const width = value.width;
  const height = value.height;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }

  return { x, y, width, height };
}

function computeSelectionBounds(
  nodes: AgentEditRequest["selectedNodes"],
): AgentScopeRect {
  const first = nodes[0];
  if (!first) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = first.rect.x;
  let minY = first.rect.y;
  let maxX = first.rect.x + first.rect.width;
  let maxY = first.rect.y + first.rect.height;

  for (const node of nodes.slice(1)) {
    minX = Math.min(minX, node.rect.x);
    minY = Math.min(minY, node.rect.y);
    maxX = Math.max(maxX, node.rect.x + node.rect.width);
    maxY = Math.max(maxY, node.rect.y + node.rect.height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
