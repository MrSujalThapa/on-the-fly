import { describe, expect, it } from "vitest";
import { DomRuntimeAdapter } from "../../../src/editor/dom/dom-runtime-adapter.js";
import { OTF_MANAGED_ATTR } from "../../../src/editor/dom/types.js";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import type { CropOperation, HideOperation, MoveOperation, StyleOperation, TextOperation } from "../../../src/editor/operations.js";
import { OTF_CROP_ATTR } from "../../../src/editor/dom/types.js";
import { createTestDocument } from "./test-document.js";

const PAGE_KEY = "https://example.com/";

function createTargetSignature() {
  return {
    nodeId: "node-1",
    signature: {
      cssPath: "main p.intro",
      tagName: "p",
      classList: ["intro"],
      textFingerprint: "Hello",
      boundingBoxHint: createEmptyBoundingBoxHint(),
    },
  };
}

describe("DomRuntimeAdapter", () => {
  it("applies and reverts a style operation", () => {
    const { root } = createTestDocument(`<main><p class="intro">Hello</p></main>`);
    const adapter = new DomRuntimeAdapter(root);
    const target = createTargetSignature();

    const operation: StyleOperation = {
      id: "op-style",
      type: "style",
      pageKey: PAGE_KEY,
      target,
      payload: { property: "color", value: "rgb(255, 0, 0)" },
      createdAt: 1,
      source: "manual",
      status: "approved",
    };

    const applied = adapter.applyOperation(operation);
    const element = root.querySelector("p.intro");
    const paragraph = element instanceof HTMLElement ? element : null;

    expect(applied.ok).toBe(true);
    expect(paragraph?.style.color).toBe("rgb(255, 0, 0)");
    expect(paragraph?.getAttribute(OTF_MANAGED_ATTR)).toBe("true");

    const reverted = adapter.revertOperation(operation);
    expect(reverted.ok).toBe(true);
    expect(paragraph?.style.color).toBe("");
  });

  it("applies and reverts text, hide, and move operations", () => {
    const { root } = createTestDocument(`<main><p class="intro">Hello</p></main>`);
    const adapter = new DomRuntimeAdapter(root);
    const target = createTargetSignature();
    const element = root.querySelector("p.intro") as HTMLElement;

    const textOperation: TextOperation = {
      id: "op-text",
      type: "text",
      pageKey: PAGE_KEY,
      target,
      payload: { value: "Updated", preserveFormat: true },
      createdAt: 2,
      source: "manual",
      status: "approved",
    };

    expect(adapter.applyOperation(textOperation).ok).toBe(true);
    expect(element.textContent).toBe("Updated");
    expect(adapter.revertOperation(textOperation).ok).toBe(true);
    expect(element.textContent).toBe("Hello");

    const hideOperation: HideOperation = {
      id: "op-hide",
      type: "hide",
      pageKey: PAGE_KEY,
      target,
      payload: { hidden: true },
      createdAt: 3,
      source: "manual",
      status: "approved",
    };

    expect(adapter.applyOperation(hideOperation).ok).toBe(true);
    expect(element.style.display).toBe("none");
    expect(adapter.revertOperation(hideOperation).ok).toBe(true);

    const moveOperation: MoveOperation = {
      id: "op-move",
      type: "move",
      pageKey: PAGE_KEY,
      target,
      payload: { dx: 12, dy: 8 },
      createdAt: 4,
      source: "manual",
      status: "approved",
    };

    expect(adapter.applyOperation(moveOperation).ok).toBe(true);
    expect(element.style.transform).toContain("translate(12px, 8px)");
    expect(adapter.revertOperation(moveOperation).ok).toBe(true);
    expect(element.style.transform).toBe("");
  });

  it("applies and reverts a crop operation as inline clip-path", () => {
    const { root } = createTestDocument(`<main><p class="intro">Hello</p></main>`);
    const adapter = new DomRuntimeAdapter(root);
    const target = createTargetSignature();
    const element = root.querySelector("p.intro") as HTMLElement;

    const cropOperation: CropOperation = {
      id: "op-crop",
      type: "crop",
      pageKey: PAGE_KEY,
      target,
      payload: { top: 5, right: 10, bottom: 15, left: 20 },
      createdAt: 5,
      source: "manual",
      status: "approved",
    };

    expect(adapter.applyOperation(cropOperation).ok).toBe(true);
    expect(element.style.clipPath).toBe("inset(5px 10px 15px 20px)");
    expect(element.getAttribute(OTF_CROP_ATTR)).toContain("\"top\":5");

    expect(adapter.revertOperation(cropOperation).ok).toBe(true);
    expect(element.style.clipPath).toBe("");
    expect(element.getAttribute(OTF_CROP_ATTR)).toBeNull();
  });
});
