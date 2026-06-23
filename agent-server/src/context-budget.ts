import type { AgentEditRequest, AgentVisualNode } from "../../src/shared/agent-contracts.js";
import type { EditorOperation } from "../../src/editor/operations.js";

export const CONTEXT_BUDGET_LIMITS = {
  maxSelectedNodes: 12,
  maxNearbyNodes: 16,
  maxExistingOperations: 20,
  maxInstructionLength: 500,
  maxCssPathLength: 256,
  maxClassListEntries: 8,
  maxStyleFields: 10,
} as const;

export interface ContextBudgetMetadata {
  selectedNodes: { included: number; truncated: number; total: number };
  nearbyNodes: { included: number; truncated: number; total: number };
  existingOperations: { included: number; truncated: number; total: number };
  instructionChars: number;
  instructionTruncated: boolean;
  screenshotIncluded: false;
}

export interface BudgetedAgentEditRequest {
  request: AgentEditRequest;
  budget: ContextBudgetMetadata;
}

const STYLE_FIELD_PRIORITY = [
  "display",
  "position",
  "zIndex",
  "color",
  "backgroundColor",
  "borderRadius",
  "fontSize",
  "fontWeight",
  "textAlign",
  "opacity",
  "transform",
  "overflow",
] as const satisfies ReadonlyArray<keyof AgentVisualNode["computed"]>;

export function applyContextBudget(source: AgentEditRequest): BudgetedAgentEditRequest {
  const instruction = truncateText(source.instruction.trim(), CONTEXT_BUDGET_LIMITS.maxInstructionLength);
  const selectedNodes = source.selectedNodes
    .slice(0, CONTEXT_BUDGET_LIMITS.maxSelectedNodes)
    .map((node) => compactVisualNode(node));
  const nearbyNodes = source.nearbyNodes
    .slice(0, CONTEXT_BUDGET_LIMITS.maxNearbyNodes)
    .map((node) => compactVisualNode(node));
  const existingOperations = source.existingOperations
    .slice(0, CONTEXT_BUDGET_LIMITS.maxExistingOperations)
    .map((operation) => compactExistingOperation(operation));

  const request: AgentEditRequest = {
    pageKey: source.pageKey,
    instruction,
    selection: {
      selectedNodeIds: source.selection.selectedNodeIds.slice(0, CONTEXT_BUDGET_LIMITS.maxSelectedNodes),
      source: source.selection.source,
      ...(source.selection.activeNodeId ? { activeNodeId: source.selection.activeNodeId } : {}),
      ...(source.selection.activeGroupId ? { activeGroupId: source.selection.activeGroupId } : {}),
    },
    selectedNodes,
    nearbyNodes,
    existingOperations,
  };

  return {
    request,
    budget: {
      selectedNodes: {
        included: selectedNodes.length,
        truncated: Math.max(0, source.selectedNodes.length - selectedNodes.length),
        total: source.selectedNodes.length,
      },
      nearbyNodes: {
        included: nearbyNodes.length,
        truncated: Math.max(0, source.nearbyNodes.length - nearbyNodes.length),
        total: source.nearbyNodes.length,
      },
      existingOperations: {
        included: existingOperations.length,
        truncated: Math.max(0, source.existingOperations.length - existingOperations.length),
        total: source.existingOperations.length,
      },
      instructionChars: instruction.length,
      instructionTruncated: instruction.length < source.instruction.trim().length,
      screenshotIncluded: false,
    },
  };
}

function compactVisualNode(node: AgentVisualNode): AgentVisualNode {
  const cssPath = truncateText(node.signature.cssPath, CONTEXT_BUDGET_LIMITS.maxCssPathLength);
  const classList = node.signature.classList.slice(0, CONTEXT_BUDGET_LIMITS.maxClassListEntries);
  const computed = pickStyleFields(node.computed);

  return {
    ...node,
    signature: {
      ...node.signature,
      cssPath,
      classList,
    },
    computed,
  };
}

function compactExistingOperation(operation: EditorOperation): EditorOperation {
  const targetSummary = operation.metadata?.targetSummary;
  if (!targetSummary) {
    return operation;
  }

  return {
    ...operation,
    metadata: {
      ...operation.metadata,
      targetSummary: truncateText(targetSummary, CONTEXT_BUDGET_LIMITS.maxCssPathLength),
    },
  };
}

function pickStyleFields(
  computed: AgentVisualNode["computed"],
): AgentVisualNode["computed"] {
  const picked: AgentVisualNode["computed"] = {};
  let count = 0;

  for (const key of STYLE_FIELD_PRIORITY) {
    const value = computed[key];
    if (typeof value === "string" && value.trim().length > 0) {
      picked[key] = truncateText(value, 80);
      count += 1;
      if (count >= CONTEXT_BUDGET_LIMITS.maxStyleFields) {
        break;
      }
    }
  }

  return picked;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
