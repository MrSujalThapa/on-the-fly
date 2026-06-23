import type { EditorSelection } from "../../editor/editor-selection.js";
import type { VisualNodeId } from "../../editor/ids.js";
import type { EditorOperation } from "../../editor/operations.js";
import type { AgentEditRequest } from "../../shared/agent-contracts.js";
import type { PageKey } from "../../editor/ids.js";
import type { VisualLayoutGraph } from "../../editor/visual-graph/visual-layout-graph.js";
import type { VisualNode } from "../../editor/visual-node.js";
import {
  buildAgentScopeContext,
  type AgentScopeContext,
  type AgentScopeRect,
} from "../../editor/validation/validate-agent-scope.js";
import { toAgentVisualNode } from "./visual-node-serializer.js";

const NEARBY_PADDING_PX = 80;
const MAX_NEARBY_NODES = 12;
const MAX_RELEVANT_OPERATIONS = 24;

export interface AgentContextInput {
  pageKey: PageKey;
  instruction: string;
  selection: EditorSelection;
  selectedNodes: VisualNode[];
  graph: VisualLayoutGraph;
  existingOperations: EditorOperation[];
}

export function buildAgentEditRequest(input: AgentContextInput): AgentEditRequest {
  const selectedIds = new Set(input.selection.selectedNodeIds);
  const selectedNodes = input.selectedNodes.map(toAgentVisualNode);
  const nearbyNodes = collectNearbyNodes(input.graph, input.selectedNodes, selectedIds).map(
    toAgentVisualNode,
  );
  const existingOperations = collectRelevantOperations(input.existingOperations, selectedIds);

  return {
    pageKey: input.pageKey,
    instruction: input.instruction.trim(),
    selection: {
      selectedNodeIds: [...input.selection.selectedNodeIds],
      ...(input.selection.activeNodeId ? { activeNodeId: input.selection.activeNodeId } : {}),
      ...(input.selection.activeGroupId ? { activeGroupId: input.selection.activeGroupId } : {}),
      source: input.selection.source,
    },
    selectedNodes,
    nearbyNodes,
    existingOperations,
  };
}

export function buildAgentScopeFromContext(input: AgentContextInput): AgentScopeContext {
  const nearbyNodes = collectNearbyNodes(
    input.graph,
    input.selectedNodes,
    new Set(input.selection.selectedNodeIds),
  );

  return buildAgentScopeContext({
    selectedNodeIds: input.selection.selectedNodeIds,
    nearbyNodeIds: nearbyNodes.map((node) => node.id),
    selectionBounds: computeSelectionBounds(input.selectedNodes),
    pageLevelNodeIds: collectPageLevelNodeIds(input.selectedNodes, nearbyNodes),
  });
}

export function computeSelectionBoundsFromContext(input: AgentContextInput): AgentScopeRect {
  return computeSelectionBounds(input.selectedNodes);
}

function collectPageLevelNodeIds(
  selectedNodes: VisualNode[],
  nearbyNodes: VisualNode[],
): string[] {
  return [...selectedNodes, ...nearbyNodes]
    .filter((node) => node.isPageLevel === true)
    .map((node) => node.id);
}

function collectNearbyNodes(
  graph: VisualLayoutGraph,
  selectedNodes: VisualNode[],
  selectedIds: ReadonlySet<VisualNodeId>,
): VisualNode[] {
  if (selectedNodes.length === 0) {
    return [];
  }

  const bounds = computeSelectionBounds(selectedNodes);
  const queryRect = {
    x: bounds.x - NEARBY_PADDING_PX,
    y: bounds.y - NEARBY_PADDING_PX,
    width: bounds.width + NEARBY_PADDING_PX * 2,
    height: bounds.height + NEARBY_PADDING_PX * 2,
  };

  return graph
    .findNodesInRect(queryRect, { mode: "overlap" })
    .filter((node) => !selectedIds.has(node.id))
    .slice(0, MAX_NEARBY_NODES);
}

function collectRelevantOperations(
  operations: EditorOperation[],
  selectedIds: ReadonlySet<VisualNodeId>,
): EditorOperation[] {
  return operations
    .filter((operation) => operation.status !== "preview")
    .filter((operation) => {
      const nodeId = operation.target.nodeId;
      return nodeId ? selectedIds.has(nodeId) : false;
    })
    .slice(0, MAX_RELEVANT_OPERATIONS);
}

function computeSelectionBounds(nodes: VisualNode[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
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
