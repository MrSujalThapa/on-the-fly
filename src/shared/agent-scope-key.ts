import type { EditorSelection } from "../editor/editor-selection.js";

/** Stable key for agent target scope — used to dedupe concurrent previews. */
export function buildAgentScopeKey(selection: EditorSelection): string {
  const ids = [...selection.selectedNodeIds].sort().join(",");
  if (selection.activeGroupId) {
    return `group:${selection.activeGroupId}:${ids}`;
  }
  return `nodes:${ids}`;
}
