import type { AgentEditRequest, AgentVisualNode } from "../../src/shared/agent-contracts.js";
import type { AgentScopeRect } from "../../src/editor/validation/validate-agent-scope.js";

export interface CompactDesignContext {
  instruction: string;
  selection: {
    ids: string[];
    groupId?: string;
    activeId?: string;
    bounds: AgentScopeRect;
  };
  theme: {
    colors: string[];
    backgrounds: string[];
    radius?: string;
    opacity?: string;
  };
  selected: Array<{
    id: string;
    kind: string;
    rect: AgentScopeRect;
    color?: string;
    background?: string;
    radius?: string;
    opacity?: string;
    layer?: string;
  }>;
  nearby: Array<{ id: string; kind: string; rect: AgentScopeRect }>;
  existingOps: number;
}

const DESIGN_STYLE_KEYS = ["color", "backgroundColor", "borderRadius", "opacity", "zIndex"] as const;

export function buildCompactDesignContext(request: AgentEditRequest): CompactDesignContext {
  const bounds = computeSelectionBounds(request.selectedNodes);

  return {
    instruction: request.instruction,
    selection: {
      ids: request.selection.selectedNodeIds,
      ...(request.selection.activeGroupId ? { groupId: request.selection.activeGroupId } : {}),
      ...(request.selection.activeNodeId ? { activeId: request.selection.activeNodeId } : {}),
      bounds,
    },
    theme: summarizeTheme(request.selectedNodes),
    selected: request.selectedNodes.map((node) => compactSelectedNode(node)),
    nearby: request.nearbyNodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      rect: node.rect,
    })),
    existingOps: request.existingOperations.length,
  };
}

function compactSelectedNode(node: AgentVisualNode): CompactDesignContext["selected"][number] {
  const entry: CompactDesignContext["selected"][number] = {
    id: node.id,
    kind: node.kind,
    rect: node.rect,
  };

  for (const key of DESIGN_STYLE_KEYS) {
    const value = node.computed[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
    switch (key) {
      case "color":
        entry.color = value;
        break;
      case "backgroundColor":
        entry.background = value;
        break;
      case "borderRadius":
        entry.radius = value;
        break;
      case "opacity":
        entry.opacity = value;
        break;
      case "zIndex":
        entry.layer = value;
        break;
      default:
        break;
    }
  }

  return entry;
}

function summarizeTheme(nodes: AgentVisualNode[]): CompactDesignContext["theme"] {
  const colors = uniqueValues(nodes.map((node) => node.computed.color));
  const backgrounds = uniqueValues(nodes.map((node) => node.computed.backgroundColor));
  const radius = nodes.find((node) => node.computed.borderRadius)?.computed.borderRadius;
  const opacity = nodes.find((node) => node.computed.opacity)?.computed.opacity;

  return {
    colors,
    backgrounds,
    ...(radius ? { radius } : {}),
    ...(opacity ? { opacity } : {}),
  };
}

function uniqueValues(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.trim().length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result.slice(0, 4);
}

function computeSelectionBounds(nodes: AgentVisualNode[]): AgentScopeRect {
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
