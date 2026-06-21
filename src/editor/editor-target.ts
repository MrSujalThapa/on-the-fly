import type { ElementSignature } from "./element-signature.js";
import type { GroupId, VisualNodeId } from "./ids.js";

export interface EditorTarget {
  nodeId?: VisualNodeId;
  groupId?: GroupId;
  signature?: ElementSignature;
}

export function hasEditorTargetReference(target: EditorTarget): boolean {
  return target.nodeId !== undefined || target.groupId !== undefined || target.signature !== undefined;
}
