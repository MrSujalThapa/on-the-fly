import { describe, expect, it, vi, afterEach } from "vitest";
import { createEditSession } from "../../src/content/edit-session.js";
import { createTestPageCustomization } from "./edit-session-test-helpers.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";
import * as storageClient from "../../src/content/storage-client.js";

function dispatchKey(win: typeof globalThis, key: string): void {
  win.dispatchEvent(
    new win.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function dispatchPointer(
  win: typeof globalThis,
  target: EventTarget,
  type: "pointerdown" | "pointerup",
  init: { clientX: number; clientY: number; buttons?: number },
): void {
  target.dispatchEvent(
    new win.PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      button: 0,
      buttons: init.buttons ?? 0,
      pointerId: 1,
      clientX: init.clientX,
      clientY: init.clientY,
    }),
  );
}

async function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

describe("Interact mode", () => {
  afterEach(() => {
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
    vi.restoreAllMocks();
  });

  it("toggles with I and hides overlays while allowing page clicks through pipeline", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><button id="action">Save</button></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const button = doc.querySelector("#action") as HTMLButtonElement;

    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(button, { x: 20, y: 20, width: 120, height: 36 });

    const pageClick = vi.fn();
    button.addEventListener("click", pageClick);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchKey(win, "i");
    expect(session.isInteractMode()).toBe(true);
    expect(shell.getSessionMode()).toBe("interact");

    const clickEvent = new win.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    button.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(false);
    expect(pageClick).toHaveBeenCalled();

    dispatchKey(win, "i");
    expect(session.isInteractMode()).toBe(false);
    expect(shell.getSessionMode()).toBe("edit");

    session.stop();
    shell.unmount();
  });

  it("does not create frozen or pinned clones when returning from Interact Mode", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `
      <main>
        <button id="trigger" aria-expanded="true" aria-controls="menu">Profile</button>
        <div id="menu" role="menu" style="position:absolute; z-index:100">
          <span id="item">Settings</span>
        </div>
      </main>
    `;
    const main = doc.querySelector("main") as HTMLElement;
    const menu = doc.querySelector("#menu") as HTMLElement;
    const item = doc.querySelector("#item") as HTMLElement;

    layoutElement(main, { x: 0, y: 0, width: 400, height: 400 });
    layoutElement(menu, { x: 10, y: 40, width: 180, height: 120 });
    layoutElement(item, { x: 20, y: 50, width: 120, height: 24 });
    doc.elementsFromPoint = vi.fn(() => [item, menu, main, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchKey(win, "i");
    expect(session.isInteractMode()).toBe(true);

    dispatchKey(win, "i");
    expect(session.isInteractMode()).toBe(false);
    expect(shell.getSessionMode()).toBe("edit");
    expect(doc.querySelector('[data-otf-pinned-surface="true"]')).toBeNull();

    session.stop();
    shell.unmount();
  });

  it("Escape exits interact mode before clearing selection", async () => {
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

    dispatchKey(win, "i");
    expect(session.isInteractMode()).toBe(true);

    const handled = session.handleEscape();
    expect(handled).toBe(true);
    expect(session.isInteractMode()).toBe(false);
    expect(shell.getSessionMode()).toBe("edit");

    session.stop();
    shell.unmount();
  });

  it("suppresses page button clicks in Edit Mode", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><button id="action">Save</button></main>`;
    const main = doc.querySelector("main") as HTMLElement;
    const button = doc.querySelector("#action") as HTMLButtonElement;

    layoutElement(main, { x: 10, y: 10, width: 400, height: 200 });
    layoutElement(button, { x: 20, y: 20, width: 120, height: 36 });

    const pageClick = vi.fn();
    button.addEventListener("click", pageClick);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    const clickEvent = new win.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    button.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(pageClick).not.toHaveBeenCalled();

    session.stop();
    shell.unmount();
  });

  it("does not persist edits on ephemeral dropdown selections", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `
      <main>
        <button id="trigger" aria-expanded="true" aria-controls="menu">Profile</button>
        <div id="menu" role="menu" style="position:absolute; z-index:100">
          <span id="item">Settings</span>
        </div>
      </main>
    `;
    const main = doc.querySelector("main") as HTMLElement;
    const menu = doc.querySelector("#menu") as HTMLElement;
    const item = doc.querySelector("#item") as HTMLElement;

    layoutElement(main, { x: 0, y: 0, width: 400, height: 400 });
    layoutElement(menu, { x: 10, y: 40, width: 180, height: 120 });
    layoutElement(item, { x: 20, y: 50, width: 120, height: 24 });
    doc.elementsFromPoint = vi.fn(() => [item, menu, main, doc.body, doc.documentElement]);

    const saveSpy = vi.spyOn(storageClient, "savePageOperations").mockResolvedValue({ ok: true });
    const debugMessages: string[] = [];

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
      onDebug: (message) => {
        debugMessages.push(message);
      },
    });
    await session.start();

    dispatchPointer(win, item, "pointerdown", {
      clientX: 30,
      clientY: 60,
      buttons: 1,
    });
    dispatchPointer(win, item, "pointerup", {
      clientX: 30,
      clientY: 60,
      buttons: 0,
    });
    await nextFrame();
    dispatchKey(win, "t");

    session.applyStyle("color", "rgb(255, 0, 0)");

    expect(debugMessages).toContain("ephemeral-surface-not-persistable");
    expect(saveSpy).not.toHaveBeenCalled();
    expect(doc.querySelector('[data-otf-pinned-surface="true"]')).toBeNull();

    session.stop();
    shell.unmount();
  });

  it("shows interact mode indicator text", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p>Hello</p></main>`;

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    dispatchKey(win, "i");
    const label = shell.getShadowRoot()?.querySelector(".otf-indicator-label");
    expect(label?.textContent).toBe("Interact mode — site clicks enabled");

    session.stop();
    shell.unmount();
  });
});
