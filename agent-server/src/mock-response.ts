import type { AgentEditRequest, AgentEditResponse } from "../../src/shared/agent-contracts.js";
import { compileDesignPlan } from "../../src/editor/agent/compile-design-plan.js";
import { prepareAgentDraftOperations } from "../../src/editor/agent/normalize-helper-object-operation.js";
import { validateAgentOperations } from "../../src/editor/validation/validate-agent-operation.js";
import {
  buildAgentScopeContext,
  type AgentScopeRect,
} from "../../src/editor/validation/validate-agent-scope.js";
import type { AgentDesignPlan } from "../../src/shared/agent-design-plan.js";
import { parseModelAgentEditResponse } from "./response-validation.js";

export function buildMockAgentEditResponse(request: AgentEditRequest): AgentEditResponse {
  const designPlan: AgentDesignPlan = {
    actions: [
      {
        kind: "add_surface",
        params: {
          placement: "behind",
          fill: "gradient",
          mood: "cool",
          shadow: "soft",
          radius: "rounded",
          intensity: "subtle",
        },
      },
    ],
  };

  const parsed = parseModelAgentEditResponse(
    {
      designPlan,
      summary: [
        "Added one soft background panel behind the selected area.",
        "Preview only. Nothing is saved until approval.",
      ],
      warnings: request.selectedNodes.length === 0 ? ["No selected nodes were provided."] : [],
      confidence: "high",
    },
    request,
  );

  if (!parsed.ok) {
    const fallback = compileMockFallback(request);
    return fallback;
  }

  return parsed.response;
}

function compileMockFallback(request: AgentEditRequest): AgentEditResponse {
  const designPlan: AgentDesignPlan = {
    actions: [{ kind: "add_surface", params: { placement: "behind", fill: "gradient" } }],
  };
  const compiled = compileDesignPlan(designPlan, request);
  if (!compiled.ok) {
    return {
      draftOperations: [],
      summary: ["Mock compile failed."],
      warnings: compiled.errors,
      confidence: "low",
    };
  }

  const prepared = prepareAgentDraftOperations(compiled.operations, request);
  const scope = buildAgentScopeContext({
    selectedNodeIds: request.selection.selectedNodeIds,
    nearbyNodeIds: request.nearbyNodes.map((node) => node.id),
    selectionBounds: computeSelectionBounds(request.selectedNodes),
  });
  const validation = prepared.ok
    ? validateAgentOperations(prepared.operations, scope)
    : { ok: false as const, errors: prepared.errors, codes: [] as never[] };

  return {
    draftOperations: validation.ok ? validation.operations : [],
    summary: ["Added one soft background panel behind the selected area."],
    warnings: validation.ok ? [] : validation.errors,
    confidence: validation.ok ? "high" : "low",
  };
}

function computeSelectionBounds(
  nodes: AgentEditRequest["selectedNodes"],
): AgentScopeRect {
  const first = nodes[0];
  if (!first) {
    return { x: 40, y: 40, width: 240, height: 120 };
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
