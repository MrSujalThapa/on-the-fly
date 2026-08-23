import { describe, expect, it, vi } from "vitest";
import { createEditorRuntime } from "../../src/runtime-v2/create-editor-runtime.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { layoutManagedElement } from "../editor/measurement/layout-helpers.js";

function pointer(target: HTMLElement, type: string, x: number, y: number): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: x,
    clientY: y,
    pointerId: 1,
  }));
}

function click(target: HTMLElement): void {
  pointer(target, "pointerdown", 40, 40);
  pointer(target, "pointerup", 40, 40);
}

describe("Runtime V2 selection cycling", () => {
  it("selects the visual parent on a second no-drag click", () => {
    const { document, root } = createTestDocument(`<article><p>Notification text</p></article>`);
    const parent = root.querySelector("article") as HTMLElement;
    const child = root.querySelector("p") as HTMLElement;
    layoutManagedElement(parent, { x: 20, y: 20, width: 240, height: 100 });
    layoutManagedElement(child, { x: 30, y: 30, width: 200, height: 40 });
    document.elementsFromPoint = () => [child, parent];
    const runtime = createEditorRuntime(document);
    const selectParent = vi.spyOn(runtime, "selectParent");
    runtime.start();

    click(child);
    expect(selectParent).not.toHaveBeenCalled();
    click(child);
    expect(selectParent).toHaveReturnedWith(expect.any(String));

    pointer(child, "pointerdown", 40, 40);
    pointer(child, "pointermove", 60, 50);
    expect(parent.style.transform).toContain("translate(20px, 10px)");
    expect(child.style.transform).toBe("");
    runtime.stop();
  });

  it("lets a threshold-crossing drag move the selected child", () => {
    const { document, root } = createTestDocument(`<article><p>Notification text</p></article>`);
    const child = root.querySelector("p") as HTMLElement;
    layoutManagedElement(child, { x: 30, y: 30, width: 200, height: 40 });
    document.elementsFromPoint = () => [child];
    const runtime = createEditorRuntime(document);
    const selectParent = vi.spyOn(runtime, "selectParent");
    runtime.start();

    click(child);
    const childId = runtime.visualModel.adopt(child);
    pointer(child, "pointerdown", 40, 40);
    pointer(child, "pointermove", 80, 60);
    pointer(child, "pointerup", 80, 60);
    expect(selectParent).not.toHaveBeenCalled();
    expect(runtime.ledger.activeOperations()[0]?.target.nodeId).toBe(childId);
    runtime.stop();
  });

  it("keeps selection when no valid visual parent exists", () => {
    const { document, root } = createTestDocument(`<article>Standalone</article>`);
    const child = root.querySelector("article") as HTMLElement;
    layoutManagedElement(child, { x: 20, y: 20, width: 200, height: 60 });
    document.elementsFromPoint = () => [child];
    const runtime = createEditorRuntime(document);
    const selectParent = vi.spyOn(runtime, "selectParent");
    runtime.start();

    click(child);
    click(child);
    expect(selectParent).toHaveReturnedWith(null);
    pointer(child, "pointerdown", 40, 40);
    pointer(child, "pointermove", 60, 50);
    expect(child.style.transform).toContain("translate(20px, 10px)");
    runtime.stop();
  });
});
