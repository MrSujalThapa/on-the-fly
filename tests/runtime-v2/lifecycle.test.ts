import { describe, expect, it } from "vitest";
import { createTestDocument } from "../editor/dom/test-document.js";
import { createEditorRuntime } from "../../src/runtime-v2/create-editor-runtime.js";
import { OTF_ROOT_HOST_ID } from "../../src/editor/measurement/constants.js";

describe("RuntimeLifecycle", () => {
  it("start then stop removes the overlay host and restores page input", () => {
    const { document } = createTestDocument(`<article class="card">Card</article>`);
    const html = document.documentElement;
    html.style.userSelect = "auto";
    const runtime = createEditorRuntime(document);
    runtime.start();
    expect(document.getElementById(OTF_ROOT_HOST_ID)).not.toBeNull();
    expect(html.style.userSelect).toBe("none");
    runtime.stop();
    expect(document.getElementById(OTF_ROOT_HOST_ID)).toBeNull();
    expect(html.style.userSelect).toBe("auto");
  });

  it("stop mid-move restores preview and does not commit", () => {
    const { document, root } = createTestDocument(`<article class="card">Card</article>`);
    const element = root.querySelector("article");
    const view = document.defaultView;
    if (!(element instanceof HTMLElement) || !view) {
      return;
    }

    document.elementsFromPoint = () => [element];
    const runtime = createEditorRuntime(document);
    runtime.start();
    const beforeStyle = element.getAttribute("style");

    view.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 24, clientY: 24, button: 0, bubbles: true }),
    );
    view.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 80, clientY: 60, button: 0, bubbles: true }),
    );
    expect(element.style.transform).toContain("translate");

    runtime.stop();
    expect(runtime.ledger.activeOperations()).toHaveLength(0);
    expect(element.getAttribute("style")).toBe(beforeStyle);
    expect(document.getElementById(OTF_ROOT_HOST_ID)).toBeNull();
  });
});
