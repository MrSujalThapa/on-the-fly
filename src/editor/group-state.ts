import type { ElementSignature } from "./element-signature.js";
import type { GroupId, VisualNodeId } from "./ids.js";

export interface GroupState {
  groupId: GroupId;
  memberNodeIds: VisualNodeId[];
  memberSignatures: ElementSignature[];
}
