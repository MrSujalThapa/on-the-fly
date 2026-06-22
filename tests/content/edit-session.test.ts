import { describe, expect, it, vi, afterEach } from "vitest";
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

describe("EditSession gesture pipeline", () => {
  afterEach(() => {
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
  });

  it("resolves a rectangle drag into a selection via elementsFromPoint", () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `
      <main>
        <section id="card-a" style="background:#fff;border-radius:12px">
          <h2 id="title-a">Alpha</h2>
          <p id="copy-a">alpha copy</p>
        </section>
        <section id="card-b" style="background:#fff;border-radius:12px">
          <h2 id="title-b">Beta</h2>
          <p id="copy-b">beta copy</p>
        </section>
      </main>
    `;

    const main = doc.querySelector("main") as HTMLElement;
    const cardA = doc.querySelector("#card-a") as HTMLElement;
    const titleA = doc.querySelector("#title-a") as HTMLElement;
    const copyA = doc.querySelector("#copy-a") as HTMLElement;
    const cardB = doc.querySelector("#card-b") as HTMLElement;
    const titleB = doc.querySelector("#title-b") as HTMLElement;
    const copyB = doc.querySelector("#copy-b") as HTMLElement;

    layoutElement(main, { x: 10, y: 10, width: 400, height: 400 });
    layoutElement(cardA, { x: 20, y: 20, width: 200, height: 120 });
    layoutElement(titleA, { x: 30, y: 30, width: 100, height: 24 });
    layoutElement(copyA, { x: 30, y: 60, width: 150, height: 20 });
    layoutElement(cardB, { x: 20, y: 160, width: 200, height: 120 });
    layoutElement(titleB, { x: 30, y: 170, width: 100, height: 24 });
    layoutElement(copyB, { x: 30, y: 200, width: 150, height: 20 });

    doc.elementsFromPoint = vi.fn((_x: number, y: number) => {
      const stack: Element[] = y < 150 ? [copyA, cardA] : [copyB, cardB];
      return [...stack, main, doc.body, doc.documentElement];
    });

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const outlineSpy = vi.spyOn(shell, "renderSelectionOutlines");
    const lassoSpy = vi.spyOn(shell, "renderLassoBox");

    const session = createEditSession({ shell, root: doc });
    session.start();

    dispatchPointer(win, copyA, "pointerdown", { clientX: 30, clientY: 30, buttons: 1 });
    dispatchPointer(win, copyA, "pointermove", { clientX: 200, clientY: 220, buttons: 1 });
    dispatchPointer(win, copyA, "pointerup", { clientX: 200, clientY: 220, buttons: 0 });

    const drewRectangle = lassoSpy.mock.calls.some((call) => call[0] !== null);
    const lastOutline = outlineSpy.mock.calls.at(-1);

    expect(drewRectangle).toBe(true);
    expect(lastOutline?.[0]?.length ?? 0).toBeGreaterThan(0);

    session.stop();
    shell.unmount();
  });

  it("selects a single element on click without activating the page", () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><a id="link" href="https://example.com"><span id="label">Go</span></a></main>`;

    const main = doc.querySelector("main") as HTMLElement;
    const link = doc.querySelector("#link") as HTMLAnchorElement;
    const label = doc.querySelector("#label") as HTMLElement;

    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(link, { x: 20, y: 20, width: 160, height: 28 });
    layoutElement(label, { x: 28, y: 24, width: 60, height: 20 });

    doc.elementsFromPoint = vi.fn(() => [label, link, main, doc.body, doc.documentElement]);

    const navHandler = vi.fn();
    link.addEventListener("click", navHandler);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const outlineSpy = vi.spyOn(shell, "renderSelectionOutlines");

    const session = createEditSession({ shell, root: doc });
    session.start();

    dispatchPointer(win, label, "pointerdown", { clientX: 40, clientY: 30, buttons: 1 });
    dispatchPointer(win, label, "pointerup", { clientX: 40, clientY: 30, buttons: 0 });

    const lastOutline = outlineSpy.mock.calls.at(-1);
    expect(lastOutline?.[0]?.length ?? 0).toBeGreaterThan(0);
    expect(navHandler).not.toHaveBeenCalled();

    session.stop();
    shell.unmount();
  });
});
