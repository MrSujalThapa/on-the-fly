import { describe, expect, it } from "vitest";
import { createTestDocument } from "../dom/test-document.js";
import { layoutElement } from "../measurement/layout-helpers.js";
import { resolveOperationAffectedRect } from "../../../src/editor/save-window/resolve-operation-rect.js";
import { createHideOperation, createInsertHelperObjectOperation, createStyleOperation, PAGE_KEY } from "../fixtures.js";
import type { DuplicateOperation } from "../../../src/editor/operations.js";

describe("resolve operation affected rect", () => {
  it("uses stored metadata for hidden operations", () => {
    const operation = createHideOperation({
      payload: { hidden: true },
      metadata: {
        affectedRect: { x: 10, y: 20, width: 80, height: 40 },
      },
    });

    const { document } = createTestDocument(`<main><p id="x">Hidden</p></main>`);
    const result = resolveOperationAffectedRect(document, operation);
    expect(result.rect).toEqual({ x: 10, y: 20, width: 80, height: 40 });
    expect(result.unresolved).toBe(false);
  });

  it("classifies hidden operations without stored rect as unresolved", () => {
    const operation = createHideOperation({
      payload: { hidden: true },
    });
    const { document } = createTestDocument(`<main><p id="x">Hidden</p></main>`);
    const result = resolveOperationAffectedRect(document, operation);
    expect(result.rect).toBeNull();
    expect(result.unresolved).toBe(true);
  });

  it("classifies duplicate operations by stored current rect metadata", () => {
    const { document } = createTestDocument(`<main></main>`);
    const operation: DuplicateOperation = {
      id: "dup-2",
      type: "duplicate",
      pageKey: PAGE_KEY,
      target: { nodeId: "clone-2" },
      payload: {
        cloneId: "clone-2",
        html: "<div>Clone</div>",
        parentCssPath: "body",
        offsetDx: 12,
        offsetDy: 12,
        anchorLeft: 0,
        anchorTop: 0,
        anchorWidth: 90,
        anchorHeight: 50,
        styleSnapshot: {},
      },
      createdAt: 1,
      source: "manual",
      status: "approved",
      metadata: {
        affectedRect: { x: 300, y: 40, width: 90, height: 50 },
      },
    };

    const result = resolveOperationAffectedRect(document, operation);
    expect(result.reason).toBe("stored_metadata_rect");
    expect(result.rect).toEqual({ x: 300, y: 40, width: 90, height: 50 });
  });

  it("falls back to resolved target rect for style operations", () => {
    const { document, root } = createTestDocument(`<main><p id="copy">Hello</p></main>`);
    const copy = root.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 40, y: 60, width: 120, height: 24 });

    const operation = createStyleOperation({
      target: {
        nodeId: "node-1",
        signature: {
          cssPath: "main p#copy",
          tagName: "p",
          classList: [],
          idAttr: "copy",
          boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
        },
      },
    });

    const result = resolveOperationAffectedRect(document, operation);
    expect(result.rect).toEqual({ x: 40, y: 60, width: 120, height: 24 });
  });

  it("uses helper payload rect for insertHelperObject operations", () => {
    const { document } = createTestDocument(`<main></main>`);
    const operation = createInsertHelperObjectOperation({
      payload: {
        ...createInsertHelperObjectOperation().payload,
        rect: { x: 10, y: 40, width: 140, height: 80 },
      },
    });

    const result = resolveOperationAffectedRect(document, operation);
    expect(result.reason).toBe("insert_helper_payload");
    expect(result.rect).toEqual({ x: 10, y: 40, width: 140, height: 80 });
    expect(result.unresolved).toBe(false);
  });
});
