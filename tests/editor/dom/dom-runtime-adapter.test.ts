import { describe, expect, it } from "vitest";
import { DomRuntimeAdapter } from "../../../src/editor/dom/dom-runtime-adapter.js";
import { OTF_HELPER_ATTR, OTF_MANAGED_ATTR } from "../../../src/editor/dom/types.js";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import type { CropOperation, HideOperation, MoveOperation, ResizeOperation, StyleOperation, TextOperation, ZIndexOperation } from "../../../src/editor/operations.js";
import { OTF_CROP_ATTR } from "../../../src/editor/dom/types.js";
import { createTestDocument } from "./test-document.js";
import { createInsertHelperObjectOperation } from "../fixtures.js";

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

  it("applies and reverts text operations on blocks with inline children", () => {
    const { root } = createTestDocument(
      `<main><p class="intro">Hello <a>Radical Ventures</a></p></main>`,
    );
    const adapter = new DomRuntimeAdapter(root);
    const target = createTargetSignature();
    const element = root.querySelector("p.intro") as HTMLElement;

    const textOperation: TextOperation = {
      id: "op-text-block",
      type: "text",
      pageKey: PAGE_KEY,
      target,
      payload: { value: "Updated block", preserveFormat: true },
      createdAt: 6,
      source: "manual",
      status: "approved",
    };

    expect(adapter.applyOperation(textOperation).ok).toBe(true);
    expect(element.textContent).toBe("Updated block");
    expect(adapter.revertOperation(textOperation).ok).toBe(true);
    expect(element.textContent).toBe("Hello Radical Ventures");
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

  it("applies, reverts, and replays helper objects", () => {
    const { root } = createTestDocument(`<main><p class="intro">Hello</p></main>`);
    const adapter = new DomRuntimeAdapter(root);
    const operation = createInsertHelperObjectOperation();

    expect(adapter.applyOperation(operation).ok).toBe(true);
    const helper = root.querySelector(`[${OTF_HELPER_ATTR}="helper-panel-1"]`) as HTMLElement;
    expect(helper).toBeInstanceOf(HTMLElement);
    expect(helper.getAttribute(OTF_MANAGED_ATTR)).toBe("true");
    expect(helper.style.position).toBe("absolute");
    expect(helper.style.left).toBe("24px");
    expect(helper.style.width).toBe("240px");
    expect(helper.style.backgroundImage).toContain("linear-gradient");
    expect(helper.style.boxShadow).toContain("rgba(15, 23, 42, 0.18)");

    expect(adapter.revertOperation(operation).ok).toBe(true);
    expect(root.querySelector(`[${OTF_HELPER_ATTR}="helper-panel-1"]`)).toBeNull();

    const replayAdapter = new DomRuntimeAdapter(root);
    expect(replayAdapter.replayOperations([operation]).every((result) => result.ok)).toBe(true);
    expect(root.querySelector(`[${OTF_HELPER_ATTR}="helper-panel-1"]`)).toBeInstanceOf(HTMLElement);
  });

  it("allows helper objects to be manually targeted by transform, layer, hide, and style ops", () => {
    const { root } = createTestDocument(`<main><p class="intro">Hello</p></main>`);
    const adapter = new DomRuntimeAdapter(root);
    const insert = createInsertHelperObjectOperation();
    expect(adapter.applyOperation(insert).ok).toBe(true);

    const target = insert.target;
    const move: MoveOperation = {
      id: "op-helper-move",
      type: "move",
      pageKey: PAGE_KEY,
      target,
      payload: { dx: 10, dy: 14 },
      createdAt: 10,
      source: "manual",
      status: "approved",
    };
    const resize: ResizeOperation = {
      id: "op-helper-resize",
      type: "resize",
      pageKey: PAGE_KEY,
      target,
      payload: { width: 300, height: 160, mode: "box" },
      createdAt: 11,
      source: "manual",
      status: "approved",
    };
    const layer: ZIndexOperation = {
      id: "op-helper-layer",
      type: "zIndex",
      pageKey: PAGE_KEY,
      target,
      payload: { layer: 20 },
      createdAt: 12,
      source: "manual",
      status: "approved",
    };
    const style: StyleOperation = {
      id: "op-helper-style",
      type: "style",
      pageKey: PAGE_KEY,
      target,
      payload: { property: "boxShadow", value: "0px 20px 40px rgba(0, 0, 0, 0.2)" },
      createdAt: 13,
      source: "manual",
      status: "approved",
    };
    const hide: HideOperation = {
      id: "op-helper-hide",
      type: "hide",
      pageKey: PAGE_KEY,
      target,
      payload: { hidden: true },
      createdAt: 14,
      source: "manual",
      status: "approved",
    };

    expect(adapter.applyOperation(move).ok).toBe(true);
    expect(adapter.applyOperation(resize).ok).toBe(true);
    expect(adapter.applyOperation(layer).ok).toBe(true);
    expect(adapter.applyOperation(style).ok).toBe(true);
    expect(adapter.applyOperation(hide).ok).toBe(true);

    const helper = root.querySelector(`[${OTF_HELPER_ATTR}="helper-panel-1"]`) as HTMLElement;
    expect(helper.style.transform).toContain("translate(10px, 14px)");
    expect(helper.style.width).toBe("300px");
    expect(helper.style.height).toBe("160px");
    expect(helper.style.zIndex).toBe("20");
    expect(helper.style.boxShadow).toBe("0px 20px 40px rgba(0, 0, 0, 0.2)");
    expect(helper.style.display).toBe("none");
  });
});
