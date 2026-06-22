import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("EditSession transform integration", () => {
  afterEach(() => {
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
  });

  it("moves a selected element and still resolves a later rectangle selection", () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `
      <main>
        <section id="card-a"><p id="copy-a">alpha copy</p></section>
        <section id="card-b"><p id="copy-b">beta copy</p></section>
      </main>
    `;

    const main = doc.querySelector("main") as HTMLElement;
    const cardA = doc.querySelector("#card-a") as HTMLElement;
    const copyA = doc.querySelector("#copy-a") as HTMLElement;
    const cardB = doc.querySelector("#card-b") as HTMLElement;
    const copyB = doc.querySelector("#copy-b") as HTMLElement;

    layoutElement(main, { x: 10, y: 10, width: 400, height: 400 });
    layoutElement(cardA, { x: 20, y: 20, width: 200, height: 100 });
    layoutElement(copyA, { x: 30, y: 40, width: 150, height: 20 });
    layoutElement(cardB, { x: 20, y: 200, width: 200, height: 100 });
    layoutElement(copyB, { x: 30, y: 220, width: 150, height: 20 });

    doc.elementsFromPoint = vi.fn((_x: number, y: number) => {
      const stack: Element[] = y < 160 ? [copyA, cardA] : [copyB, cardB];
      return [...stack, main, doc.body, doc.documentElement];
    });

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const outlineSpy = vi.spyOn(shell, "renderSelectionOutlines");

    const session = createEditSession({ shell, root: doc });
    session.start();

    // Select element A with a click.
    dispatchPointer(win, copyA, "pointerdown", { clientX: 40, clientY: 45, buttons: 1 });
    dispatchPointer(win, copyA, "pointerup", { clientX: 40, clientY: 45, buttons: 0 });

    const selectedRects = outlineSpy.mock.calls.at(-1)?.[0] ?? [];
    expect(selectedRects.length).toBeGreaterThan(0);

    // Drag the selected element to move it.
    dispatchPointer(win, copyA, "pointerdown", { clientX: 50, clientY: 50, buttons: 1 });
    dispatchPointer(win, copyA, "pointermove", { clientX: 90, clientY: 90, buttons: 1 });
    dispatchPointer(win, copyA, "pointerup", { clientX: 90, clientY: 90, buttons: 0 });

    const movedElement = copyA.style.transform.includes("translate")
      ? copyA
      : cardA;
    expect(movedElement.style.transform).toContain("translate");

    // A fresh rectangle selection over card B must still resolve nodes.
    outlineSpy.mockClear();
    dispatchPointer(win, copyB, "pointerdown", { clientX: 25, clientY: 205, buttons: 1 });
    dispatchPointer(win, copyB, "pointermove", { clientX: 210, clientY: 295, buttons: 1 });
    dispatchPointer(win, copyB, "pointerup", { clientX: 210, clientY: 295, buttons: 0 });

    const lassoRects = outlineSpy.mock.calls.at(-1)?.[0] ?? [];
    expect(lassoRects.length).toBeGreaterThan(0);

    session.stop();
    shell.unmount();
  });

  it("layer shortcuts prevent default and re-stack the selected element", () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `
      <main>
        <section id="card-a"><p id="copy-a">alpha copy</p></section>
      </main>
    `;

    const main = doc.querySelector("main") as HTMLElement;
    const cardA = doc.querySelector("#card-a") as HTMLElement;
    const copyA = doc.querySelector("#copy-a") as HTMLElement;

    layoutElement(main, { x: 10, y: 10, width: 400, height: 400 });
    layoutElement(cardA, { x: 20, y: 20, width: 200, height: 100 });
    layoutElement(copyA, { x: 30, y: 40, width: 150, height: 20 });

    doc.elementsFromPoint = vi.fn(() => [copyA, cardA, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });

    const session = createEditSession({ shell, root: doc });
    session.start();

    dispatchPointer(win, copyA, "pointerdown", { clientX: 40, clientY: 45, buttons: 1 });
    dispatchPointer(win, copyA, "pointerup", { clientX: 40, clientY: 45, buttons: 0 });

    const forward = new win.KeyboardEvent("keydown", {
      ctrlKey: true,
      code: "BracketRight",
      key: "]",
      bubbles: true,
      cancelable: true,
    });
    win.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);

    const layered = [cardA, copyA].filter((element) => element.style.zIndex !== "");
    expect(layered.length).toBeGreaterThan(0);
    for (const element of layered) {
      expect(element.style.position).toBe("relative");
    }

    // Ctrl+Shift+] reports key "}" but code stays "BracketRight": must register.
    const toFront = new win.KeyboardEvent("keydown", {
      ctrlKey: true,
      shiftKey: true,
      code: "BracketRight",
      key: "}",
      bubbles: true,
      cancelable: true,
    });
    win.dispatchEvent(toFront);
    expect(toFront.defaultPrevented).toBe(true);
    expect(layered.some((element) => element.style.zIndex === "2147483000")).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("ignores repeated Delete keydown and clears selection after hide", () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `
      <main>
        <section id="card-a"><p id="copy-a">alpha copy</p></section>
      </main>
    `;

    const main = doc.querySelector("main") as HTMLElement;
    const cardA = doc.querySelector("#card-a") as HTMLElement;
    const copyA = doc.querySelector("#copy-a") as HTMLElement;

    layoutElement(main, { x: 10, y: 10, width: 400, height: 400 });
    layoutElement(cardA, { x: 20, y: 20, width: 200, height: 100 });
    layoutElement(copyA, { x: 30, y: 40, width: 150, height: 20 });

    doc.elementsFromPoint = vi.fn(() => [copyA, cardA, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const outlineSpy = vi.spyOn(shell, "renderSelectionOutlines");
    const hideDebug: unknown[] = [];

    const session = createEditSession({
      shell,
      root: doc,
      onDebug: (message, data) => {
        if (message === "transform-hide" || message === "hide-noop") {
          hideDebug.push({ message, data });
        }
      },
    });
    session.start();

    dispatchPointer(win, copyA, "pointerdown", { clientX: 40, clientY: 45, buttons: 1 });
    dispatchPointer(win, copyA, "pointerup", { clientX: 40, clientY: 45, buttons: 0 });

    const repeatDelete = new win.KeyboardEvent("keydown", {
      key: "Delete",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    win.dispatchEvent(repeatDelete);
    expect(repeatDelete.defaultPrevented).toBe(false);
    expect(copyA.style.display).not.toBe("none");

    const deleteKey = new win.KeyboardEvent("keydown", {
      key: "Delete",
      repeat: false,
      bubbles: true,
      cancelable: true,
    });
    win.dispatchEvent(deleteKey);
    expect(deleteKey.defaultPrevented).toBe(true);
    expect(copyA.style.display).toBe("none");
    expect(hideDebug.filter((entry) => (entry as { message: string }).message === "transform-hide")).toHaveLength(1);

    outlineSpy.mockClear();
    const repeatAfterHide = new win.KeyboardEvent("keydown", {
      key: "Delete",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    win.dispatchEvent(repeatAfterHide);
    expect(repeatAfterHide.defaultPrevented).toBe(false);
    expect(outlineSpy).not.toHaveBeenCalled();

    session.stop();
    shell.unmount();
  });
});
