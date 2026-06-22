import type { CommandAppliesTo, CommandContext } from "../editor-command.js";
import type { EditorSelection } from "../editor-selection.js";
import type { VisualNode, VisualNodeKind } from "../visual-node.js";
import type { VisualNodeId } from "../ids.js";

export function resolveSelectionTags(
  selection: EditorSelection,
  visualNodes: ReadonlyMap<VisualNodeId, VisualNode>,
): CommandAppliesTo[] {
  const tags: CommandAppliesTo[] = [];
  const count = selection.selectedNodeIds.length;

  if (count === 0) {
    return tags;
  }

  if (selection.activeGroupId) {
    tags.push("group");
  }

  if (count > 1) {
    tags.push("multi");
  }

  for (const nodeId of selection.selectedNodeIds) {
    const node = visualNodes.get(nodeId);
    if (node) {
      tags.push(node.kind);
    }
  }

  tags.push("any");
  return tags;
}

export function commandAppliesToSelection(
  appliesTo: CommandAppliesTo[],
  tags: CommandAppliesTo[],
): boolean {
  if (appliesTo.includes("any")) {
    return true;
  }

  return appliesTo.some((tag) => tags.includes(tag));
}

export function hasActiveSelection(context: CommandContext): boolean {
  return context.selection.selectedNodeIds.length > 0 || Boolean(context.selection.activeGroupId);
}

export function selectionIncludesKind(
  context: CommandContext,
  kinds: VisualNodeKind[],
): boolean {
  for (const nodeId of context.selection.selectedNodeIds) {
    const node = context.visualNodes.get(nodeId);
    if (node && kinds.includes(node.kind)) {
      return true;
    }
  }
  return false;
}

export function isSingleTextLikeSelection(context: CommandContext): boolean {
  if (context.selection.selectedNodeIds.length !== 1) {
    return false;
  }

  const nodeId = context.selection.selectedNodeIds[0];
  if (!nodeId) {
    return false;
  }

  const node = context.visualNodes.get(nodeId);
  if (!node) {
    return false;
  }

  return node.kind === "text" || node.kind === "button" || node.kind === "input";
}

export function isSingleHandleTarget(context: CommandContext): boolean {
  return context.selection.selectedNodeIds.length === 1 && !context.selection.activeGroupId;
}
