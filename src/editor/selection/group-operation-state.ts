import type { GroupState } from "../editor-state.js";
import type { GroupId, PageKey } from "../ids.js";
import type { GroupOperation, EditorOperation, UngroupOperation } from "../operations.js";
import type { BuildOperationOptions } from "../transform/operation-factory.js";
import { createOperationId } from "../transform/operation-id.js";
import type { VirtualGroup } from "./virtual-group.js";

export function buildGroupOperation(
  group: VirtualGroup,
  options: BuildOperationOptions,
): GroupOperation {
  const id = (options.createId ?? createOperationId)();
  const createdAt = options.now ?? Date.now();
  return {
    id,
    type: "group",
    pageKey: options.pageKey,
    target: { groupId: group.id },
    payload: {
      groupId: group.id,
      memberNodeIds: [...group.memberIds],
      memberSignatures: group.members.map((member) => member.signature),
    },
    createdAt,
    source: "manual",
    status: "draft",
    metadata: {
      affectedRect: { ...group.unionRect },
      sourceCommand: options.sourceCommand ?? "group",
    },
  };
}

export function buildUngroupOperation(
  groupId: GroupId,
  options: BuildOperationOptions,
): UngroupOperation {
  const id = (options.createId ?? createOperationId)();
  const createdAt = options.now ?? Date.now();
  return {
    id,
    type: "ungroup",
    pageKey: options.pageKey,
    target: { groupId },
    payload: { groupId },
    createdAt,
    source: "manual",
    status: "draft",
    metadata: {
      sourceCommand: options.sourceCommand ?? "ungroup",
    },
  };
}

export function findLatestPersistedGroupState(
  pageKey: PageKey,
  operations: EditorOperation[],
): GroupState | null {
  const relevant = operations.filter(
    (operation) => operation.type === "group" || operation.type === "ungroup",
  );
  if (relevant.length === 0) {
    return null;
  }

  let latest: GroupState | null = null;
  const active = new Map<GroupId, GroupState>();

  for (const operation of relevant) {
    if (operation.type === "group") {
      const groupState: GroupState = {
        groupId: operation.payload.groupId,
        memberNodeIds: [...operation.payload.memberNodeIds],
        memberSignatures: [...operation.payload.memberSignatures],
      };
      active.set(groupState.groupId, groupState);
      latest = groupState;
      continue;
    }

    active.delete(operation.payload.groupId);
    if (latest?.groupId === operation.payload.groupId) {
      latest = active.size > 0 ? [...active.values()].at(-1) ?? null : null;
    }
  }

  if (latest && active.has(latest.groupId)) {
    return latest;
  }

  return active.size > 0 ? [...active.values()].at(-1) ?? null : null;
}
