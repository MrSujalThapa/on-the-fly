import type { AgentEditRequest, AgentEditResponse } from "../../src/shared/agent-contracts.js";
import type { InsertHelperObjectOperation } from "../../src/editor/operations.js";

const HELPER_PADDING_PX = 24;

export function buildMockAgentEditResponse(request: AgentEditRequest): AgentEditResponse {
  const bounds = computeSelectionBounds(request.selectedNodes);
  const helperId = createHelperId(request.pageKey);
  const operation = createHelperObjectOperation(request, bounds, helperId);

  return {
    draftOperations: [operation],
    summary: [
      "Added one soft background panel behind the selected area.",
      "Preview only. Nothing is saved until approval.",
    ],
    warnings: request.selectedNodes.length === 0 ? ["No selected nodes were provided."] : [],
    confidence: "high",
  };
}

function createHelperObjectOperation(
  request: AgentEditRequest,
  bounds: { x: number; y: number; width: number; height: number },
  helperId: string,
): InsertHelperObjectOperation {
  const rect = {
    x: Math.max(0, bounds.x - HELPER_PADDING_PX),
    y: Math.max(0, bounds.y - HELPER_PADDING_PX),
    width: Math.max(40, bounds.width + HELPER_PADDING_PX * 2),
    height: Math.max(40, bounds.height + HELPER_PADDING_PX * 2),
  };

  return {
    id: `agent-op-${helperId}`,
    type: "insertHelperObject",
    pageKey: request.pageKey,
    target: {
      nodeId: helperId,
      signature: {
        cssPath: `#otf-helper-${helperId}`,
        tagName: "div",
        classList: ["otf-helper-object"],
        idAttr: `otf-helper-${helperId}`,
        boundingBoxHint: {
          xRatio: 0,
          yRatio: 0,
          widthRatio: 0,
          heightRatio: 0,
        },
      },
    },
    payload: {
      helperId,
      role: "backgroundPanel",
      rect,
      fill: {
        type: "linearGradient",
        angleDeg: 135,
        stops: [
          { color: "#ffffff", position: 0 },
          { color: "#eef2ff", position: 100 },
        ],
      },
      borderRadius: "18px",
      opacity: 0.96,
      boxShadow: {
        offsetX: 0,
        offsetY: 10,
        blurRadius: 28,
        spreadRadius: 0,
        color: "rgba(15, 23, 42, 0.12)",
      },
      zIndex: 1,
      border: {
        width: 1,
        color: "#e5e7eb",
        style: "solid",
      },
      label: "Agent background panel",
    },
    createdAt: Date.now(),
    source: "agent",
    status: "preview",
  };
}

function computeSelectionBounds(
  nodes: AgentEditRequest["selectedNodes"],
): { x: number; y: number; width: number; height: number } {
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

function createHelperId(pageKey: string): string {
  const normalized = pageKey.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 24);
  return `mock-${normalized}-${String(Date.now())}`;
}
