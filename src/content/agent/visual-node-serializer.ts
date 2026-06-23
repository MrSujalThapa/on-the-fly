import type { AgentVisualNode } from "../../shared/agent-contracts.js";
import type { VisualNode } from "../../editor/visual-node.js";

export function toAgentVisualNode(node: VisualNode): AgentVisualNode {
  const agentNode: AgentVisualNode = {
    id: node.id,
    kind: node.kind,
    signature: node.signature,
    rect: { ...node.rect },
    computed: { ...node.computed },
    childIds: [...node.childIds],
  };

  if (node.parentId) {
    agentNode.parentId = node.parentId;
  }
  if (node.isLikelyContainer !== undefined) {
    agentNode.isLikelyContainer = node.isLikelyContainer;
  }
  if (node.isPageLevel !== undefined) {
    agentNode.isPageLevel = node.isPageLevel;
  }

  return agentNode;
}

export function assertAgentVisualNodeIsDomFree(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return !("element" in value);
}
