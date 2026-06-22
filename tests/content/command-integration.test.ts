import { describe, expect, it, afterEach } from "vitest";
import { createEditSession } from "../../src/content/edit-session.js";
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

describe("EditSession command integration", () => {
  afterEach(() => {
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
  });

  it("supports current-session undo after style edits", () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });

    doc.elementsFromPoint = () => [copy, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({ shell, root: doc });
    session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });

    session.applyStyle("color", "rgb(255, 0, 0)");
    expect(copy.style.color).toBe("rgb(255, 0, 0)");
    expect(session.canUndo()).toBe(true);

    expect(session.undo()).toBe(true);
    expect(copy.style.color).toBe("");
    expect(session.canRedo()).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("routes undo keyboard shortcut through command registry", () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello</p></main>`;
    const copy = doc.querySelector("#copy") as HTMLElement;
    layoutElement(copy, { x: 10, y: 10, width: 120, height: 24 });
    doc.elementsFromPoint = () => [copy, doc.body, doc.documentElement];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({ shell, root: doc });
    session.start();

    dispatchPointer(win, copy, "pointerdown", { clientX: 15, clientY: 15, buttons: 1 });
    dispatchPointer(win, copy, "pointerup", { clientX: 15, clientY: 15, buttons: 0 });
    session.applyStyle("color", "rgb(255, 0, 0)");

    win.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
    );

    expect(copy.style.color).toBe("");

    session.stop();
    shell.unmount();
  });
});
