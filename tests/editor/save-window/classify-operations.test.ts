import { describe, expect, it } from "vitest";
import { createTestDocument } from "../dom/test-document.js";
import { layoutElement } from "../measurement/layout-helpers.js";
import {
  classifyOperationsForSaveWindow,
  selectOperationsToKeep,
  selectOperationsToRevert,
} from "../../../src/editor/save-window/classify-operations.js";
import { createHideOperation, createMoveOperation, createStyleOperation } from "../fixtures.js";
import type { GroupOperation } from "../../../src/editor/operations.js";
import { PAGE_KEY } from "../fixtures.js";

describe("classify operations for save window", () => {
  const windowRect = { x: 0, y: 0, width: 200, height: 300 };

  it("keeps inside operations and reverts outside operations", () => {
    const { document } = createTestDocument(`<main></main>`);
    const inside = createStyleOperation({
      id: "inside",
      metadata: { affectedRect: { x: 20, y: 20, width: 60, height: 40 } },
    });
    const outside = createStyleOperation({
      id: "outside",
      metadata: { affectedRect: { x: 260, y: 20, width: 60, height: 40 } },
    });

    const classification = classifyOperationsForSaveWindow({
      root: document,
      operations: [inside, outside],
      windowRect,
    });

    expect(classification.summary.keptCount).toBe(1);
    expect(classification.summary.revertedCount).toBe(1);
    expect(selectOperationsToKeep(classification).map((op) => op.id)).toEqual(["inside"]);
    expect(selectOperationsToRevert(classification).map((op) => op.id)).toEqual(["outside"]);
  });

  it("marks partial operations as ambiguous and defaults them to revert", () => {
    const { document } = createTestDocument(`<main></main>`);
    const partial = createMoveOperation({
      id: "partial",
      metadata: { affectedRect: { x: 170, y: 40, width: 100, height: 80 } },
    });

    const classification = classifyOperationsForSaveWindow({
      root: document,
      operations: [partial],
      windowRect,
    });

    expect(classification.summary.ambiguousCount).toBe(1);
    expect(selectOperationsToRevert(classification).map((op) => op.id)).toEqual(["partial"]);
  });

  it("classifies group operations as ambiguous", () => {
    const { document } = createTestDocument(`<main></main>`);
    const group: GroupOperation = {
      id: "group-1",
      type: "group",
      pageKey: PAGE_KEY,
      target: { groupId: "g-1" },
      payload: {
        groupId: "g-1",
        memberNodeIds: ["a"],
        memberSignatures: [],
      },
      createdAt: 1,
      source: "manual",
      status: "approved",
    };

    const classification = classifyOperationsForSaveWindow({
      root: document,
      operations: [group],
      windowRect,
    });

    expect(classification.summary.ambiguousCount).toBe(1);
  });

  it("uses stored pre-hide rect for hidden operations", () => {
    const { document } = createTestDocument(`<main><p id="x">X</p></main>`);
    const hidden = createHideOperation({
      id: "hidden-inside",
      payload: { hidden: true },
      metadata: { affectedRect: { x: 30, y: 30, width: 50, height: 30 } },
    });

    const classification = classifyOperationsForSaveWindow({
      root: document,
      operations: [hidden],
      windowRect,
    });

    expect(classification.summary.keptCount).toBe(1);
  });

  it("classifies detached child independently using current rect metadata", () => {
    const { document, root } = createTestDocument(`<main><div id="child">Child</div></main>`);
    const child = root.querySelector("#child") as HTMLElement;
    layoutElement(child, { x: 320, y: 80, width: 70, height: 40 });

    const detached = createMoveOperation({
      id: "detached-child",
      payload: { dx: 200, dy: 0, detached: true },
      metadata: { affectedRect: { x: 320, y: 80, width: 70, height: 40 } },
    });

    const classification = classifyOperationsForSaveWindow({
      root: document,
      operations: [detached],
      windowRect,
    });

    expect(classification.summary.revertedCount).toBe(1);
  });
});
