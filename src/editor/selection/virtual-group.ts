import type { MatchViewport } from "../dom/types.js";
import type { ElementSignature } from "../element-signature.js";
import type { GroupId, VisualNodeId } from "../ids.js";
import { GIANT_NODE_AREA_RATIO } from "../measurement/constants.js";
import { rectArea } from "../measurement/geometry.js";
import type { VisualNode, VisualNodeRect } from "../visual-node.js";

/**
 * Virtual groups are editor-only objects. A group can contain VisualNode-backed
 * targets (resolved from the visual graph) and DOM-derived synthetic targets
 * (from DOM-first rectangle selection). The group rect is always recomputed
 * from the current member rects, never from the original DOM hierarchy.
 */

export type GroupMemberSource = "visual-node" | "dom";
export type GroupSource = GroupMemberSource | "mixed";

export interface VirtualGroupMember {
  nodeId: VisualNodeId;
  signature: ElementSignature;
  rect: VisualNodeRect;
  source: GroupMemberSource;
  isPageLevel: boolean;
}

export interface VirtualGroup {
  id: GroupId;
  memberIds: VisualNodeId[];
  members: VirtualGroupMember[];
  unionRect: VisualNodeRect;
  source: GroupSource;
  createdAt: number;
}

export interface CreateVirtualGroupOptions {
  id?: GroupId;
  now?: number;
  viewport?: MatchViewport;
}

export const MIN_GROUP_MEMBERS = 2;

let groupCounter = 0;

export function createGroupId(): GroupId {
  groupCounter += 1;
  return `otf-group-${Date.now().toString(36)}-${String(groupCounter)}`;
}

export function toGroupMember(node: VisualNode, source: GroupMemberSource): VirtualGroupMember {
  return {
    nodeId: node.id,
    signature: node.signature,
    rect: { ...node.rect },
    source,
    isPageLevel: node.isPageLevel === true,
  };
}

export function computeUnionRect(rects: VisualNodeRect[]): VisualNodeRect {
  if (rects.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }

  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function isGroupableMember(
  member: VirtualGroupMember,
  viewport?: MatchViewport,
): boolean {
  if (member.isPageLevel) {
    return false;
  }

  const tag = member.signature.tagName.toLowerCase();
  if (tag === "html" || tag === "body") {
    return false;
  }

  if (viewport && viewport.width > 0 && viewport.height > 0) {
    const ratio = rectArea(member.rect) / (viewport.width * viewport.height);
    if (ratio >= GIANT_NODE_AREA_RATIO) {
      return false;
    }
  }

  return true;
}

/**
 * Builds a virtual group from candidate members. Page-level / html / body /
 * giant-wrapper members are rejected so the page itself can never be grouped.
 * Returns null when fewer than {@link MIN_GROUP_MEMBERS} valid members remain
 * or when the resulting union would cover (almost) the whole viewport.
 */
export function createVirtualGroup(
  members: VirtualGroupMember[],
  options: CreateVirtualGroupOptions = {},
): VirtualGroup | null {
  const validMembers = members.filter((member) => isGroupableMember(member, options.viewport));
  if (validMembers.length < MIN_GROUP_MEMBERS) {
    return null;
  }

  const unionRect = computeUnionRect(validMembers.map((member) => member.rect));

  const viewport = options.viewport;
  if (viewport && viewport.width > 0 && viewport.height > 0) {
    const unionRatio = rectArea(unionRect) / (viewport.width * viewport.height);
    if (unionRatio >= GIANT_NODE_AREA_RATIO) {
      return null;
    }
  }

  const sources = new Set(validMembers.map((member) => member.source));
  const source: GroupSource = sources.size === 1 ? [...sources][0] ?? "dom" : "mixed";

  return {
    id: options.id ?? createGroupId(),
    memberIds: validMembers.map((member) => member.nodeId),
    members: validMembers,
    unionRect,
    source,
    createdAt: options.now ?? Date.now(),
  };
}

/**
 * Dynamic regrouping: recompute the group rect (and member rects) from the
 * current layout. `getCurrentRect` returns the live rect for a member, or null
 * if it can no longer be resolved (in which case the stored rect is kept).
 */
export function recomputeGroupRect(
  group: VirtualGroup,
  getCurrentRect: (member: VirtualGroupMember) => VisualNodeRect | null,
): VirtualGroup {
  const members = group.members.map((member) => {
    const currentRect = getCurrentRect(member);
    return currentRect ? { ...member, rect: { ...currentRect } } : member;
  });

  return {
    ...group,
    members,
    unionRect: computeUnionRect(members.map((member) => member.rect)),
  };
}

/**
 * Reconstructs a lightweight VisualNode from a group member so overlay
 * rendering and downstream selection logic can treat members uniformly without
 * requiring the original VisualNode to still exist in the graph.
 */
export function memberToVisualNode(member: VirtualGroupMember): VisualNode {
  return {
    id: member.nodeId,
    kind: "unknown",
    signature: member.signature,
    rect: { ...member.rect },
    computed: {},
    childIds: [],
    ...(member.isPageLevel ? { isPageLevel: true } : {}),
  };
}
