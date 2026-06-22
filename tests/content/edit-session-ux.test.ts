import { describe, expect, it, vi, afterEach } from "vitest";
import { createEditSession } from "../../src/content/edit-session.js";
import { createTestPageCustomization } from "./edit-session-test-helpers.js";
import { EditorShell } from "../../src/content/editor-shell.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";
import * as storageClient from "../../src/content/storage-client.js";

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

function dispatchKey(
  win: typeof globalThis,
  target: EventTarget,
  key: string,
): void {
  target.dispatchEvent(new win.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    composed: true,
    cancelable: true,
  }));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

async function selectElement(
  session: ReturnType<typeof createEditSession>,
  win: typeof globalThis,
  target: HTMLElement,
  x: number,
  y: number,
): Promise<void> {
  dispatchPointer(win, target, "pointerdown", { clientX: x, clientY: y, buttons: 1 });
  dispatchPointer(win, target, "pointerup", { clientX: x, clientY: y, buttons: 0 });
  await nextFrame();
  void session;
}

describe("EditSession toolbar/style UX", () => {
  afterEach(() => {
    globalThis.document.body.innerHTML = "";
    globalThis.document.getElementById("on-the-fly-root-host")?.remove();
    vi.restoreAllMocks();
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

    dispatchKey(win, doc, "t");
    await nextFrame();
    (session as unknown as { toggleStylePanel: () => void }).toggleStylePanel();
    expect((shadow.querySelector(".otf-style-panel") as HTMLElement).hidden).toBe(false);

    const panel = shadow.querySelector(".otf-style-panel") as HTMLElement;
    expect(panel.hidden).toBe(false);

    const handled = session.handleEscape();
    expect(handled).toBe(true);
    expect(panel.classList.contains("is-open")).toBe(false);

    session.stop();
    shell.unmount();
  });

  it("keeps the toolbar hidden after selection until T toggles it open", async () => {
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
    const toolbar = shadow.querySelector(".otf-curved-toolbar") as HTMLElement;
    expect(toolbar.hidden).toBe(true);

    dispatchKey(win, doc, "t");
    await nextFrame();
    expect(toolbar.hidden).toBe(false);

    dispatchKey(win, doc, "t");
    expect(toolbar.hidden).toBe(true);

    session.stop();
    shell.unmount();
  });

  it("ignores T while focus is inside a style panel field", async () => {
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

    await selectElement(session, win, copy, 40, 30);
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    dispatchKey(win, doc, "t");
    await nextFrame();
    const toolbar = shadow.querySelector(".otf-curved-toolbar") as HTMLElement;
    expect(toolbar.hidden).toBe(false);
    (session as unknown as { toggleStylePanel: () => void }).toggleStylePanel();
    expect((shadow.querySelector(".otf-style-panel") as HTMLElement).hidden).toBe(false);
    await nextFrame();
    expect(toolbar.hidden).toBe(false);

    const fontSize = shadow.querySelector('[data-style-field="fontSize"]') as HTMLInputElement;
    fontSize.focus();
    dispatchKey(win, fontSize, "t");
    expect(toolbar.hidden).toBe(false);

    session.stop();
    shell.unmount();
  });

  it("ignores T inside the in-place text editor", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello world</p></main>`;
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

    await selectElement(session, win, copy, 40, 30);
    session.openTextEditor(40, 30);
    const event = new win.KeyboardEvent("keydown", {
      key: "t",
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    copy.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(copy.getAttribute("contenteditable")).toBe("plaintext-only");

    session.stop();
    shell.unmount();
  });

  it("allows T to toggle the toolbar after crop mode is cancelled", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Crop me</p></main>`;
    const copy = doc.querySelector("#copy") as HTMLElement;

    layoutElement(copy, { x: 20, y: 20, width: 160, height: 28 });
    doc.elementsFromPoint = vi.fn(() => [copy, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    await selectElement(session, win, copy, 40, 30);
    expect(session.toggleCropMode()).toBe(true);
    dispatchKey(win, doc, "t");
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }
    const toolbar = shadow.querySelector(".otf-curved-toolbar") as HTMLElement;
    expect(toolbar.hidden).toBe(true);

    expect(session.handleEscape()).toBe(true);
    dispatchKey(win, doc, "t");
    await nextFrame();
    expect(toolbar.hidden).toBe(false);

    session.stop();
    shell.unmount();
  });

  it("cancels crop mode when clicking outside the selection", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Crop me</p><div id="outside">Outside</div></main>`;
    const copy = doc.querySelector("#copy") as HTMLElement;
    const outside = doc.querySelector("#outside") as HTMLElement;

    layoutElement(copy, { x: 20, y: 20, width: 160, height: 28 });
    layoutElement(outside, { x: 240, y: 20, width: 120, height: 40 });
    doc.elementsFromPoint = vi.fn(() => [outside, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    doc.elementsFromPoint = vi.fn(() => [copy, doc.body, doc.documentElement]);
    await selectElement(session, win, copy, 40, 30);
    expect(session.toggleCropMode()).toBe(true);

    doc.elementsFromPoint = vi.fn(() => [outside, doc.body, doc.documentElement]);
    dispatchPointer(win, outside, "pointerdown", { clientX: 260, clientY: 30, buttons: 1 });
    expect(session.isCropMode()).toBe(false);

    session.stop();
    shell.unmount();
  });

  it("Escape closes the toolbar before clearing selection", async () => {
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
    const toolbar = shadow.querySelector(".otf-curved-toolbar") as HTMLElement;
    dispatchKey(win, doc, "t");
    await nextFrame();
    expect(toolbar.hidden).toBe(false);

    expect(session.handleEscape()).toBe(true);
    expect(toolbar.hidden).toBe(true);
    expect(shadow.querySelector(".otf-selection-outline")).toBeInstanceOf(HTMLElement);

    expect(session.handleEscape()).toBe(true);
    expect(shadow.querySelector(".otf-selection-outline")).toBeNull();

    session.stop();
    shell.unmount();
  });

  it("previews style panel changes without persisting until Apply", async () => {
    const saveSpy = vi.spyOn(storageClient, "savePageOperations").mockResolvedValue({ ok: true });
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

    await selectElement(session, win, copy, 40, 30);
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    dispatchKey(win, doc, "t");
    await nextFrame();
    (session as unknown as { toggleStylePanel: () => void }).toggleStylePanel();
    const fontSize = shadow.querySelector('[data-style-field="fontSize"]') as HTMLInputElement;
    fontSize.value = "24";
    fontSize.dispatchEvent(new win.Event("input", { bubbles: true }));

    expect(copy.style.fontSize).toBe("24px");
    expect(session.canUndo()).toBe(false);
    expect(saveSpy).not.toHaveBeenCalled();

    (shadow.querySelector("[data-style-apply]") as HTMLButtonElement).click();
    expect(copy.style.fontSize).toBe("24px");
    expect(session.canUndo()).toBe(true);
    expect(saveSpy).toHaveBeenCalledTimes(1);

    expect(session.undo()).toBe(true);
    expect(copy.style.fontSize).toBe("16px");

    session.stop();
    shell.unmount();
    saveSpy.mockRestore();
  });

  it("reverts style preview when the panel closes or resets", async () => {
    const saveSpy = vi.spyOn(storageClient, "savePageOperations").mockResolvedValue({ ok: true });
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

    await selectElement(session, win, copy, 40, 30);
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    dispatchKey(win, doc, "t");
    await nextFrame();
    (session as unknown as { toggleStylePanel: () => void }).toggleStylePanel();
    const fontSize = shadow.querySelector('[data-style-field="fontSize"]') as HTMLInputElement;
    fontSize.value = "24";
    fontSize.dispatchEvent(new win.Event("input", { bubbles: true }));
    expect(copy.style.fontSize).toBe("24px");

    (shadow.querySelector("[data-style-reset]") as HTMLButtonElement).click();
    expect(copy.style.fontSize).toBe("16px");
    expect(session.canUndo()).toBe(false);

    fontSize.value = "18";
    fontSize.dispatchEvent(new win.Event("input", { bubbles: true }));
    expect(copy.style.fontSize).toBe("18px");
    (shadow.querySelector("[data-style-close]") as HTMLButtonElement).click();
    expect(copy.style.fontSize).toBe("16px");
    expect(saveSpy).not.toHaveBeenCalled();

    session.stop();
    shell.unmount();
    saveSpy.mockRestore();
  });

  it("edits selected text in place and saves with Ctrl+Enter", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Hello world</p></main>`;
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

    session.openTextEditor(40, 30);
    expect(copy.getAttribute("contenteditable")).toBe("plaintext-only");

    copy.textContent = "Updated copy";
    copy.dispatchEvent(new win.KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));

    expect(copy.textContent).toBe("Updated copy");
    expect(copy.getAttribute("contenteditable")).toBeNull();

    session.stop();
    shell.unmount();
  });

  it("starts in-place text editing from the toolbar text button for a selected container", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><section id="card"><p id="copy">Container copy</p></section></main>`;
    const card = doc.querySelector("#card") as HTMLElement;
    const copy = doc.querySelector("#copy") as HTMLElement;

    layoutElement(card, { x: 20, y: 20, width: 220, height: 120 });
    layoutElement(copy, { x: 32, y: 34, width: 140, height: 24 });
    doc.elementsFromPoint = vi.fn(() => [card, doc.body, doc.documentElement]);

    const shell = new EditorShell();
    shell.mount({ onDeactivate: () => undefined });
    const session = createEditSession({
      shell,
      root: doc,
      pageCustomization: createTestPageCustomization(doc),
    });
    await session.start();

    await selectElement(session, win, card, 40, 40);
    const shadow = shell.getShadowRoot();
    if (!shadow) {
      throw new Error("expected shadow root");
    }

    dispatchKey(win, doc, "t");
    await nextFrame();
    const textButton = shadow.querySelector('[data-command-id="text-edit"]') as HTMLButtonElement;
    expect(textButton.disabled).toBe(false);
    textButton.click();
    await Promise.resolve();

    expect(copy.getAttribute("contenteditable")).toBe("plaintext-only");

    session.stop();
    shell.unmount();
  });

  it("cancels in-place text editing with Escape and cleans up contenteditable", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Original copy</p></main>`;
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

    session.openTextEditor(40, 30);
    copy.textContent = "Should cancel";
    copy.dispatchEvent(new win.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));

    expect(copy.textContent).toBe("Original copy");
    expect(copy.getAttribute("contenteditable")).toBeNull();

    session.stop();
    shell.unmount();
  });

  it("saves changed in-place text on blur", async () => {
    const doc = globalThis.document;
    const win = globalThis.window;

    doc.body.innerHTML = `<main><p id="copy">Blur copy</p></main>`;
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

    session.openTextEditor(40, 30);
    copy.textContent = "Saved on blur";
    copy.dispatchEvent(new win.FocusEvent("blur"));

    expect(copy.textContent).toBe("Saved on blur");
    expect(copy.getAttribute("contenteditable")).toBeNull();

    session.stop();
    shell.unmount();
  });
});
