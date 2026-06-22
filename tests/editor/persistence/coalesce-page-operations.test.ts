import { describe, expect, it } from "vitest";
import { coalescePageOperations } from "../../../src/editor/persistence/coalesce-page-operations.js";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import type { HideOperation } from "../../../src/editor/operations.js";

const PAGE_KEY = "https://example.com/";

function hideOp(id: string, cssPath: string, hidden: boolean): HideOperation {
  return {
    id,
    type: "hide",
    pageKey: PAGE_KEY,
    target: {
      nodeId: cssPath,
      signature: {
        cssPath,
        tagName: "div",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
    },
    payload: { hidden },
    createdAt: 1,
    source: "manual",
    status: "approved",
  };
}

describe("coalescePageOperations", () => {
  it("drops repeated hide ops for the same target", () => {
    const existing = [hideOp("hide-1", "main .a", true)];
    const incoming = [hideOp("hide-2", "main .a", true)];

    const result = coalescePageOperations(existing, incoming);

    expect(result.applied).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.operations.map((op) => op.id)).toEqual(["hide-1"]);
  });

  it("keeps hide ops for different targets", () => {
    const existing = [hideOp("hide-a", "main .a", true)];
    const incoming = [hideOp("hide-b", "main .b", true)];

    const result = coalescePageOperations(existing, incoming);

    expect(result.applied).toBe(1);
    expect(result.operations.map((op) => op.id)).toEqual(["hide-a", "hide-b"]);
  });

  it("removes a prior hide when showing the target", () => {
    const existing = [hideOp("hide-a", "main .a", true)];
    const incoming = [hideOp("show-a", "main .a", false)];

    const result = coalescePageOperations(existing, incoming);

    expect(result.applied).toBe(1);
    expect(result.operations).toEqual([]);
  });
});
