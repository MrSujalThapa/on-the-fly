import { describe, expect, it } from "vitest";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import {
  computeUnionRect,
  createVirtualGroup,
  isGroupableMember,
  memberToVisualNode,
  recomputeGroupRect,
  type VirtualGroupMember,
} from "../../../src/editor/selection/virtual-group.js";

const VIEWPORT = { width: 1000, height: 800 };

function member(overrides: Partial<VirtualGroupMember> & Pick<VirtualGroupMember, "nodeId">): VirtualGroupMember {
  return {
    signature: {
      cssPath: `main #${overrides.nodeId}`,
      tagName: "div",
      classList: [],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
    rect: { x: 0, y: 0, width: 100, height: 60 },
    source: "dom",
    isPageLevel: false,
    ...overrides,
  };
}

describe("computeUnionRect", () => {
  it("computes a bounding rect covering all member rects", () => {
    const union = computeUnionRect([
      { x: 20, y: 20, width: 80, height: 40 },
      { x: 200, y: 120, width: 100, height: 60 },
    ]);

    expect(union).toEqual({ x: 20, y: 20, width: 280, height: 160 });
  });
});

describe("createVirtualGroup", () => {
  it("creates a group with union rect and per-member metadata", () => {
    const group = createVirtualGroup(
      [
        member({ nodeId: "a", rect: { x: 20, y: 20, width: 80, height: 40 }, source: "visual-node" }),
        member({ nodeId: "b", rect: { x: 200, y: 120, width: 100, height: 60 }, source: "dom" }),
      ],
      { id: "group-1", now: 123, viewport: VIEWPORT },
    );

    expect(group).not.toBeNull();
    expect(group?.id).toBe("group-1");
    expect(group?.memberIds).toEqual(["a", "b"]);
    expect(group?.members).toHaveLength(2);
    expect(group?.unionRect).toEqual({ x: 20, y: 20, width: 280, height: 160 });
    expect(group?.source).toBe("mixed");
    expect(group?.createdAt).toBe(123);
  });

  it("returns a single-source group when all members share a source", () => {
    const group = createVirtualGroup(
      [
        member({ nodeId: "a", source: "dom", rect: { x: 0, y: 0, width: 100, height: 60 } }),
        member({ nodeId: "b", source: "dom", rect: { x: 120, y: 0, width: 100, height: 60 } }),
      ],
      { id: "group-2" },
    );

    expect(group?.source).toBe("dom");
  });

  it("returns null when fewer than two valid members remain", () => {
    const group = createVirtualGroup([member({ nodeId: "only" })], { id: "group-3" });
    expect(group).toBeNull();
  });

  it("never groups html/body/page-level wrappers", () => {
    const group = createVirtualGroup(
      [
        member({ nodeId: "body", signature: { cssPath: "body", tagName: "body", classList: [], boundingBoxHint: createEmptyBoundingBoxHint() } }),
        member({ nodeId: "html", signature: { cssPath: "html", tagName: "html", classList: [], boundingBoxHint: createEmptyBoundingBoxHint() } }),
        member({ nodeId: "page", isPageLevel: true }),
        member({ nodeId: "card", rect: { x: 40, y: 40, width: 200, height: 120 } }),
      ],
      { id: "group-4", viewport: VIEWPORT },
    );

    // Only one real member remains after filtering wrappers, so no group forms.
    expect(group).toBeNull();
  });

  it("rejects giant wrappers relative to the viewport", () => {
    expect(
      isGroupableMember(
        member({ nodeId: "giant", rect: { x: 0, y: 0, width: 990, height: 780 } }),
        VIEWPORT,
      ),
    ).toBe(false);
  });

  it("returns null when the union would cover the whole viewport", () => {
    const group = createVirtualGroup(
      [
        member({ nodeId: "tl", rect: { x: 0, y: 0, width: 40, height: 40 } }),
        member({ nodeId: "br", rect: { x: 950, y: 750, width: 40, height: 40 } }),
      ],
      { id: "group-5", viewport: VIEWPORT },
    );

    expect(group).toBeNull();
  });
});

describe("recomputeGroupRect", () => {
  it("recomputes the union rect from current member rects", () => {
    const group = createVirtualGroup(
      [
        member({ nodeId: "a", rect: { x: 20, y: 20, width: 80, height: 40 } }),
        member({ nodeId: "b", rect: { x: 200, y: 120, width: 100, height: 60 } }),
      ],
      { id: "group-6", viewport: VIEWPORT },
    );
    if (!group) {
      throw new Error("expected group to be created");
    }

    const moved = recomputeGroupRect(group, (m) =>
      m.nodeId === "b" ? { x: 400, y: 300, width: 100, height: 60 } : null,
    );

    expect(moved.unionRect).toEqual({ x: 20, y: 20, width: 480, height: 340 });
    // Members with no current rect keep their stored rect.
    expect(moved.members[0]?.rect).toEqual({ x: 20, y: 20, width: 80, height: 40 });
    expect(moved.members[1]?.rect).toEqual({ x: 400, y: 300, width: 100, height: 60 });
  });
});

describe("memberToVisualNode", () => {
  it("reconstructs a VisualNode from a member for overlay rendering", () => {
    const node = memberToVisualNode(member({ nodeId: "x", rect: { x: 5, y: 6, width: 7, height: 8 } }));
    expect(node.id).toBe("x");
    expect(node.rect).toEqual({ x: 5, y: 6, width: 7, height: 8 });
  });
});
