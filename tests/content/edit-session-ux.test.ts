import { describe, expect, it, vi, afterEach } from "vitest";
import { createEditSession } from "../../src/content/edit-session.js";
import { createTestPageCustomization } from "./edit-session-test-helpers.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";

function dispatchPointer(
  win: typeof globalThis,
  target: EventTarget,
  type: string,
  init: { clientX: number; clientY: number; buttons?: number },
): void {
  const event = new win.PointerEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    button: 0,
    buttons: init.buttons ?? 0,
    pointerId: 1,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  target.dispatchEvent(event);
}

describe("EditSession toolbar/style UX", () => {
  afterEach(() => {
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
  });

  it("closes the style panel on Escape before clearing selection", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const copy = doc.querySelector("#copy") as HTMLElement;

    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(copy, { x: 20, y: 20, width: 160, height: 28 });
    doc.elementsFromPoint = vi.fn(() => [copy, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });

    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    const styleButton = shadow.querySelector('[data-command-id="style-panel"]') as HTMLButtonElement;
    styleButton.click();

    const panel = shadow.querySelector(".otf-style-panel") as HTMLElement;
    expect(panel.hidden).toBe(false);

    const handled = session.handleEscape();
    expect(handled).toBe(true);
    expect(panel.classList.contains("is-open")).toBe(false);

    session.stop();
    shell.unmount();
  });

  it("shows only one contextual toolbar after selection", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const copy = doc.querySelector("#copy") as HTMLElement;

    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(copy, { x: 20, y: 20, width: 160, height: 28 });
    doc.elementsFromPoint = vi.fn(() => [copy, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });

    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }
    expect(shadow.querySelectorAll(".otf-curved-toolbar")).toHaveLength(1);
    expect(shadow.querySelector(".rotation-controls")).toBeNull();
    expect((shadow.querySelector(".otf-curved-toolbar") as HTMLElement).hidden).toBe(false);

    session.stop();
    shell.unmount();
  });
});
