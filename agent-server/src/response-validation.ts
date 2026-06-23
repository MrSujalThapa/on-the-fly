import type { AgentEditRequest, AgentEditResponse } from "../../src/shared/agent-contracts.js";
import { compileDesignPlan } from "../../src/editor/agent/compile-design-plan.js";
import { prepareAgentDraftOperations } from "../../src/editor/agent/normalize-helper-object-operation.js";
import { validateAgentOperations } from "../../src/editor/validation/validate-agent-operation.js";
import {
  buildAgentScopeContext,
  type AgentScopeRect,
} from "../../src/editor/validation/validate-agent-scope.js";
import { validateDesignPlanShape } from "./design-plan-validation.js";

const MAX_SUMMARY_LINES = 12;
const MAX_WARNING_LINES = 12;

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

import type { AgentLatencyStages } from "../../src/shared/agent-latency.js";

export type ModelResponseParseResult =
  | {
      ok: true;
      response: AgentEditResponse;
      latency: Pick<AgentLatencyStages, "compileMs" | "validationMs">;
    }
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

  const rawOpsRejection = rejectRawEditorOperations(raw);
  if (rawOpsRejection) {
    return rawOpsRejection;
  }

  if (!isRecord(raw.designPlan)) {
    return {
      ok: false,
      errors: ["designPlan is required — raw draftOperations are not accepted"],
      code: "invalid_model_output",
    };
  }

  const planValidation = validateDesignPlanShape(raw.designPlan);
  if (!planValidation.ok) {
    return {
      ok: false,
      errors: planValidation.errors,
      code: "invalid_model_output",
    };
  }

  const compileStartedAt = Date.now();
  const compiled = compileDesignPlan(planValidation.plan, request);
  const compileMs = Date.now() - compileStartedAt;
  if (!compiled.ok) {
    return {
      ok: false,
      errors: compiled.errors,
      code: "invalid_model_output",
    };
  }

  const prepared = prepareAgentDraftOperations(compiled.operations, request);
  if (!prepared.ok) {
    return {
      ok: false,
      errors: prepared.errors,
      code: "invalid_model_output",
    };
  }

  const validationStartedAt = Date.now();
  const scope = buildScopeFromRequest(request);
  const validation = validateAgentOperations(prepared.operations, scope);
  const validationMs = Date.now() - validationStartedAt;
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
      draftOperations: validation.operations,
      summary: normalizeStringArray(raw.summary, MAX_SUMMARY_LINES),
      warnings: normalizeStringArray(raw.warnings, MAX_WARNING_LINES),
      confidence: normalizeConfidence(raw.confidence),
    },
    latency: { compileMs, validationMs },
  };
}

function rejectRawEditorOperations(raw: Record<string, unknown>): ModelResponseParseResult | null {
  if ("draftOperations" in raw) {
    return {
      ok: false,
      errors: [
        "draftOperations are not accepted from the model — return designPlan.actions instead",
      ],
      code: "invalid_model_output",
    };
  }

  if (Array.isArray(raw.operations)) {
    return {
      ok: false,
      errors: ["raw operations array is not accepted — return designPlan.actions instead"],
      code: "invalid_model_output",
    };
  }

  return null;
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
