import { describe, expect, it, vi } from "vitest";
import { DomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";
import { createStyleTextController } from "../../src/content/style-text-controller.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { createTestSignature } from "../editor/fixtures.js";

describe("StyleTextController", () => {
  it("applies style operations and notifies onApply", () => {
    const { document, root } = createTestDocument(`<main><p class="intro">Hello</p></main>`);
    const element = root.querySelector("p.intro") as HTMLElement;
    const onApply = vi.fn();

    const controller = createStyleTextController({
      document,
      adapter: new DomRuntimeAdapter(root),
      getPageKey: () => "https://example.com/",
      resolveTargets: () => [{
        nodeId: "node-1",
        signature: createTestSignature({ cssPath: "main p.intro" }),
        rect: { x: 0, y: 0, width: 100, height: 20 },
        element,
      }],
      resolveTextTarget: () => null,
      onApply,
    });

    const applied = controller.applyStyle("backgroundColor", "rgb(255, 0, 0)");
    expect(applied).toHaveLength(1);
    expect(element.style.backgroundColor).toBe("rgb(255, 0, 0)");
    expect(onApply).toHaveBeenCalledWith(applied);
  });

  it("applies text operations while preserving leaf formatting contract", () => {
    const { document, root } = createTestDocument(`<main><p class="intro">Hello</p></main>`);
    const element = root.querySelector("p.intro") as HTMLElement;
    const target = {
      nodeId: "node-1",
      signature: createTestSignature({ cssPath: "main p.intro" }),
      rect: { x: 0, y: 0, width: 100, height: 20 },
      element,
    };

    const controller = createStyleTextController({
      document,
      adapter: new DomRuntimeAdapter(root),
      getPageKey: () => "https://example.com/",
      resolveTargets: () => [target],
      resolveTextTarget: () => target,
    });

    const applied = controller.applyText("Updated copy");
    expect(applied).toHaveLength(1);
    expect(applied[0]?.type).toBe("text");
    if (applied[0]?.type === "text") {
      expect(applied[0].payload.preserveFormat).toBe(true);
    }
    expect(element.textContent).toBe("Updated copy");
  });
});
