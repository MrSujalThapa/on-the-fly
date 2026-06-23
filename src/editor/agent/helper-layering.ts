import type { AgentEditRequest } from "../../shared/agent-contracts.js";
import type { EditorOperation, InsertHelperObjectOperation, ZIndexOperation } from "../operations.js";
import type { EditorTarget } from "../editor-target.js";

const MIN_HELPER_LAYER = 0;
const MAX_SAFE_LAYER = 9998;

export interface ScopeLayeringPlan {
  helperLayer: number;
  selectionLayer: number;
}

export function resolveScopeLayering(request: AgentEditRequest): ScopeLayeringPlan {
  const layers = request.selectedNodes.map((node) => parseLayer(node.computed.zIndex));
  const maxLayer = layers.length > 0 ? Math.max(...layers) : 0;
  const minLayer = layers.length > 0 ? Math.min(...layers) : 0;

  const helperLayer =
    minLayer > MIN_HELPER_LAYER ? Math.max(MIN_HELPER_LAYER, minLayer - 1) : MIN_HELPER_LAYER;
  const selectionLayer = Math.min(MAX_SAFE_LAYER, Math.max(maxLayer + 1, helperLayer + 1));

  return { helperLayer, selectionLayer };
}

export function applyScopeLayeringToOperations(
  operations: EditorOperation[],
  request: AgentEditRequest,
  now = Date.now(),
): EditorOperation[] {
  const plan = resolveScopeLayering(request);
  const normalized: EditorOperation[] = [];
  let liftIndex = 0;

  for (const operation of operations) {
    if (operation.type === "insertHelperObject") {
      normalized.push(normalizeHelperLayer(operation, plan, request));
      continue;
    }
    normalized.push(operation);
  }

  const needsLift = request.selectedNodes.some(
    (node) => parseLayer(node.computed.zIndex) < plan.selectionLayer,
  );

  if (!needsLift) {
    return normalized;
  }

  for (const node of request.selectedNodes) {
    if (parseLayer(node.computed.zIndex) >= plan.selectionLayer) {
      continue;
    }
    if (normalized.some(
      (op) => op.type === "zIndex" && op.target.nodeId === node.id && op.payload.layer >= plan.selectionLayer,
    )) {
      continue;
    }
    normalized.push(createSelectionLiftOperation(node.id, node.signature, request, plan.selectionLayer, now, liftIndex));
    liftIndex += 1;
  }

  return normalized;
}

function normalizeHelperLayer(
  operation: InsertHelperObjectOperation,
  plan: ScopeLayeringPlan,
  request: AgentEditRequest,
): InsertHelperObjectOperation {
  const placement = inferHelperPlacement(operation);
  const layer =
    placement === "overlay"
      ? Math.min(MAX_SAFE_LAYER, plan.selectionLayer + 1)
      : plan.helperLayer;

  return {
    ...operation,
    payload: {
      ...operation.payload,
      zIndex: layer,
    },
    ...(request.selection.activeGroupId
      ? { target: { ...operation.target, groupId: request.selection.activeGroupId } }
      : {}),
  };
}

function inferHelperPlacement(operation: InsertHelperObjectOperation): "behind" | "overlay" {
  const z = operation.payload.zIndex;
  return typeof z === "number" && z >= 5 ? "overlay" : "behind";
}

function createSelectionLiftOperation(
  nodeId: string,
  signature: EditorTarget["signature"],
  request: AgentEditRequest,
  layer: number,
  now: number,
  index: number,
): ZIndexOperation {
  const target: EditorTarget = {
    nodeId,
    ...(signature ? { signature } : {}),
    ...(request.selection.activeGroupId ? { groupId: request.selection.activeGroupId } : {}),
  };

  return {
    id: `agent-op-${String(now)}-lift-${String(index)}`,
    type: "zIndex",
    pageKey: request.pageKey,
    target,
    payload: { layer },
    createdAt: now,
    source: "agent",
    status: "preview",
  };
}

function parseLayer(value: string | undefined): number {
  if (!value || value.trim() === "" || value === "auto") {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
