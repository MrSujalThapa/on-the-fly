import { describe, expect, it } from "vitest";
import {
  buildGroupOperation,
  buildUngroupOperation,
  findLatestPersistedGroupState,
} from "../../../src/editor/selection/group-operation-state.js";
import { createVirtualGroup, toGroupMember } from "../../../src/editor/selection/virtual-group.js";
import { createTestSignature } from "../fixtures.js";
import type { VisualNode } from "../../../src/editor/visual-node.js";

const PAGE_KEY = "https://example.com/";

function createMember(id: string): VisualNode {
  return {
    id,
    kind: "text",
    signature: createTestSignature({ cssPath: `main p#${id}`, idAttr: id }),
    rect: { x: 10, y: 10, width: 100, height: 40 },
    computed: {},
    childIds: [],
  };
}

describe("group operation state", () => {
  it("builds group and ungroup operations from a virtual group", () => {
    const group = createVirtualGroup(
      [createMember("a"), createMember("b")].map((node) => toGroupMember(node, "visual-node")),
      { id: "group-1" },
    );
    if (!group) {
      throw new Error("expected group");
    }

    const groupOperation = buildGroupOperation(group, { pageKey: PAGE_KEY });
    expect(groupOperation.type).toBe("group");
    expect(groupOperation.payload.groupId).toBe("group-1");
    expect(groupOperation.payload.memberNodeIds).toEqual(["a", "b"]);

    const ungroupOperation = buildUngroupOperation("group-1", { pageKey: PAGE_KEY });
    expect(ungroupOperation.type).toBe("ungroup");
    expect(ungroupOperation.payload.groupId).toBe("group-1");
  });

  it("finds the latest still-active persisted group", () => {
    const groupAState = createVirtualGroup(
      [createMember("a"), createMember("b")].map((node) => toGroupMember(node, "visual-node")),
      { id: "group-a" },
    );
    const groupBState = createVirtualGroup(
      [createMember("c"), createMember("d")].map((node) => toGroupMember(node, "visual-node")),
      { id: "group-b" },
    );
    if (!groupAState || !groupBState) {
      throw new Error("expected groups");
    }

    const groupA = buildGroupOperation(groupAState, { pageKey: PAGE_KEY, createId: () => "op-group-a" });
    const groupB = buildGroupOperation(groupBState, { pageKey: PAGE_KEY, createId: () => "op-group-b" });
    const ungroupA = buildUngroupOperation("group-a", {
      pageKey: PAGE_KEY,
      createId: () => "op-ungroup-a",
    });

    expect(findLatestPersistedGroupState(PAGE_KEY, [groupA])).toEqual({
      groupId: "group-a",
      memberNodeIds: ["a", "b"],
      memberSignatures: groupA.payload.memberSignatures,
    });

    expect(findLatestPersistedGroupState(PAGE_KEY, [groupA, groupB, ungroupA])?.groupId).toBe(
      "group-b",
    );
  });
});
