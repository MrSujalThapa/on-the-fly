import type { GroupId, VisualNodeId } from "./ids.js";

export type SelectionSource = "click" | "shift-click" | "lasso" | "group" | "replay";

export interface EditorSelection {
  selectedNodeIds: VisualNodeId[];
  activeNodeId?: VisualNodeId;
  activeGroupId?: GroupId;
  source: SelectionSource;
}

export function createEmptySelection(): EditorSelection {
  return {
    selectedNodeIds: [],
    source: "click",
  };
}
