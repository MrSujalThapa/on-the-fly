import { describe, expect, it } from "vitest";
import { buildHideOperation } from "../../../src/editor/transform/operation-factory.js";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import type { TransformTarget } from "../../../src/editor/transform/transform-target.js";
import { createTestDocument } from "../dom/test-document.js";

describe("buildHideOperation", () => {
  it("persists a fresh signature from the live element without synthetic node ids", () => {
    const { root } = createTestDocument(`
      <main><img class="avatar" alt="Sam" src="/avatars/sam.jpg" /></main>
    `);
    const image = root.querySelector("img.avatar") as HTMLImageElement;

    const target: TransformTarget = {
      nodeId: "otf-rect-0",
      signature: {
        cssPath: "stale-path",
        tagName: "img",
        classList: [],
        boundingBoxHint: createEmptyBoundingBoxHint(),
      },
      rect: { x: 0, y: 0, width: 40, height: 40 },
      element: image,
    };

    const operation = buildHideOperation(target, true, { pageKey: "https://example.com/" }, "block", image);

    expect(operation.target.nodeId).toBeUndefined();
    expect(operation.target.signature?.cssPath).toContain("img.avatar");
    expect(operation.target.signature?.altAttr).toBe("Sam");
    expect(operation.target.signature?.srcFingerprint).toBe("avatars/sam.jpg");
  });
});
