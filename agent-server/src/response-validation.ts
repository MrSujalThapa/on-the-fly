import type { AgentEditRequest, AgentEditResponse } from "../../src/shared/agent-contracts.js";
import { prepareAgentDraftOperations } from "../../src/editor/agent/normalize-helper-object-operation.js";
import { validateAgentOperations } from "../../src/editor/validation/validate-agent-operation.js";
import {
  buildAgentScopeContext,
  type AgentScopeRect,
} from "../../src/editor/validation/validate-agent-scope.js";
import type { EditorOperation } from "../../src/editor/operations.js";

const MAX_AGENT_OPERATIONS = 12;
const MAX_SUMMARY_LINES = 12;
const MAX_WARNING_LINES = 12;

const FORBIDDEN_OPERATION_TYPES = new Set(["duplicate"]);
const FORBIDDEN_CONTENT_PATTERNS = [
  /<script\b/i,
  /<\/script>/i,
  /<style\b/i,
  /javascript:/i,
  /\bon\w+\s*=/i,
  /\beval\s*\(/i,
  /expression\s*\(/i,
  /<iframe\b/i,
  /<object\b/i,
  /<embed\b/i,
];

export type ModelResponseParseResult =
  | { ok: true; response: AgentEditResponse }
  | { ok: false; errors: string[]; code: "malformed_json" | "invalid_model_output" | "unsafe_model_output" };

export function parseModelAgentEditResponse(
  raw: unknown,
  request: AgentEditRequest,
): ModelResponseParseResult {
  if (typeof raw === "string") {
    try {
      return parseModelAgentEditResponse(JSON.parse(raw), request);
    } catch {
      return {
        ok: false,
        errors: ["model output was not valid JSON"],
        code: "malformed_json",
      };
    }
  }

  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: ["model output must be an object"],
      code: "malformed_json",
    };
  }

  const serialized = JSON.stringify(raw);
  const forbidden = findForbiddenContent(serialized);
  if (forbidden.length > 0) {
    return {
      ok: false,
      errors: forbidden,
      code: "unsafe_model_output",
    };
  }

  if (!Array.isArray(raw.draftOperations)) {
    return {
      ok: false,
      errors: ["draftOperations must be an array"],
      code: "invalid_model_output",
    };
  }

  if (raw.draftOperations.length > MAX_AGENT_OPERATIONS) {
    return {
      ok: false,
      errors: [`model output exceeded max operations (${String(MAX_AGENT_OPERATIONS)})`],
      code: "unsafe_model_output",
    };
  }

  for (const [index, operation] of raw.draftOperations.entries()) {
    const typeError = rejectForbiddenOperationType(operation, index);
    if (typeError) {
      return typeError;
    }
  }

  const normalized = normalizeAgentEditResponse(raw, request);
  const prepared = prepareAgentDraftOperations(normalized.draftOperations, request);
  if (!prepared.ok) {
    return {
      ok: false,
      errors: prepared.errors,
      code: "invalid_model_output",
    };
  }

  const scope = buildScopeFromRequest(request);
  const validation = validateAgentOperations(prepared.operations, scope);
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      code: validation.codes.includes("out_of_scope")
        ? "unsafe_model_output"
        : "invalid_model_output",
    };
  }

  return {
    ok: true,
    response: {
      ...normalized,
      draftOperations: validation.operations,
    },
  };
}

function rejectForbiddenOperationType(
  operation: unknown,
  index: number,
): ModelResponseParseResult | null {
  if (!isRecord(operation) || typeof operation.type !== "string") {
    return null;
  }

  if (FORBIDDEN_OPERATION_TYPES.has(operation.type)) {
    return {
      ok: false,
      errors: [`operations[${String(index)}].type "${operation.type}" is not allowed from agent output`],
      code: "unsafe_model_output",
    };
  }

  if (operation.type === "duplicate" || hasRawHtmlPayload(operation)) {
    return {
      ok: false,
      errors: [`operations[${String(index)}] carries raw HTML and is not allowed`],
      code: "unsafe_model_output",
    };
  }

  return null;
}

function hasRawHtmlPayload(operation: Record<string, unknown>): boolean {
  const payload = operation.payload;
  if (!isRecord(payload)) {
    return false;
  }

  if (typeof payload.html === "string" && payload.html.trim().length > 0) {
    return true;
  }

  if (operation.type === "text" && typeof payload.value === "string") {
    return /<\w+/u.test(payload.value);
  }

  if (operation.type === "style" && typeof payload.value === "string") {
    const value = payload.value.trim();
    if (value.includes("<") || value.includes("url(") && /javascript:/i.test(value)) {
      return true;
    }
  }

  return false;
}

function findForbiddenContent(serialized: string): string[] {
  const errors: string[] = [];
  for (const pattern of FORBIDDEN_CONTENT_PATTERNS) {
    if (pattern.test(serialized)) {
      errors.push(`model output contains forbidden content matching ${pattern.source}`);
    }
  }
  return errors;
}

function normalizeAgentEditResponse(
  raw: Record<string, unknown>,
  request: AgentEditRequest,
): AgentEditResponse {
  const draftOperations = Array.isArray(raw.draftOperations)
    ? raw.draftOperations.map((entry, index) =>
        normalizeOperation(entry, request, index),
      )
    : [];

  return {
    draftOperations,
    summary: normalizeStringArray(raw.summary, MAX_SUMMARY_LINES),
    warnings: normalizeStringArray(raw.warnings, MAX_WARNING_LINES),
    confidence: normalizeConfidence(raw.confidence),
  };
}

function normalizeOperation(
  value: unknown,
  request: AgentEditRequest,
  index: number,
): EditorOperation {
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

  return operation as unknown as EditorOperation;
}

function buildScopeFromRequest(request: AgentEditRequest) {
  return buildAgentScopeContext({
    selectedNodeIds: request.selection.selectedNodeIds,
    nearbyNodeIds: request.nearbyNodes.map((node) => node.id),
    selectionBounds: computeSelectionBounds(request.selectedNodes),
    pageLevelNodeIds: [...request.selectedNodes, ...request.nearbyNodes]
      .filter((node) => node.isPageLevel === true)
      .map((node) => node.id),
  });
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

function normalizeStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, maxItems);
}

function normalizeConfidence(value: unknown): AgentEditResponse["confidence"] {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "medium";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
