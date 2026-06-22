import { describe, expect, it, vi } from "vitest";
import {
  attachEditModePointerPipeline,
  type EditModeEventWindow,
} from "../../src/content/edit-mode-pointer-pipeline.js";
import { Window } from "happy-dom";

describe("edit mode pointer pipeline", () => {
  it("owns page pointer gestures in capture phase and suppresses activation", () => {
    const happyWindow = new Window({ innerWidth: 1024, innerHeight: 768 });
    const document = happyWindow.document as unknown as Document;
    document.body.innerHTML = `<main><button id="action">Save</button></main>`;

    const button = document.querySelector("#action") as HTMLButtonElement;
    const pageClickHandler = vi.fn();
    const otfHandler = vi.fn();

    button.addEventListener("click", pageClickHandler);

    const pipeline = attachEditModePointerPipeline({
      window: happyWindow as unknown as EditModeEventWindow,
      document,
      onPointerDown: () => {
        otfHandler("down");
      },
      onPointerMove: () => undefined,
      onPointerUp: () => {
        otfHandler("up");
      },
      onPointerCancel: () => undefined,
    });

    const pointerDown = new happyWindow.PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    button.dispatchEvent(pointerDown as unknown as Event);

    expect(otfHandler).toHaveBeenCalledWith("down");
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(pageClickHandler).not.toHaveBeenCalled();

    pipeline.detach();
  });

  it("suppresses link navigation clicks while attached", () => {
    const happyWindow = new Window({ innerWidth: 1024, innerHeight: 768 });
    const document = happyWindow.document as unknown as Document;
    document.body.innerHTML = `<main><a id="link" href="https://example.com">Go</a></main>`;

    const link = document.querySelector("#link") as HTMLAnchorElement;
    const clickHandler = vi.fn();
    link.addEventListener("click", clickHandler);

    const pipeline = attachEditModePointerPipeline({
      window: happyWindow as unknown as EditModeEventWindow,
      document,
      onPointerDown: () => undefined,
      onPointerMove: () => undefined,
      onPointerUp: () => undefined,
      onPointerCancel: () => undefined,
    });

    const clickEvent = new happyWindow.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    link.dispatchEvent(clickEvent as unknown as Event);

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(clickHandler).not.toHaveBeenCalled();

    pipeline.detach();
  });

  it("suppresses linked image click, auxclick, and dblclick activation", () => {
    const happyWindow = new Window({ innerWidth: 1024, innerHeight: 768 });
    const document = happyWindow.document as unknown as Document;
    document.body.innerHTML = `
      <main><a id="ad" href="https://ads.example.com"><img id="image" src="ad.png" alt="Ad" /></a></main>
    `;

    const link = document.querySelector("#ad") as HTMLAnchorElement;
    const image = document.querySelector("#image") as HTMLImageElement;
    const clickHandler = vi.fn();
    link.addEventListener("click", clickHandler);
    link.addEventListener("auxclick", clickHandler);
    link.addEventListener("dblclick", clickHandler);

    const pipeline = attachEditModePointerPipeline({
      window: happyWindow as unknown as EditModeEventWindow,
      document,
      onPointerDown: () => undefined,
      onPointerMove: () => undefined,
      onPointerUp: () => undefined,
      onPointerCancel: () => undefined,
    });

    for (const type of ["click", "auxclick", "dblclick"]) {
      const event = new happyWindow.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: type === "auxclick" ? 1 : 0,
      });
      image.dispatchEvent(event as unknown as Event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(clickHandler).not.toHaveBeenCalled();

    pipeline.detach();
  });

  it("does not suppress events inside active contenteditable text", () => {
    const happyWindow = new Window({ innerWidth: 1024, innerHeight: 768 });
    const document = happyWindow.document as unknown as Document;
    document.body.innerHTML = `<main><p id="copy" contenteditable="plaintext-only">Edit me</p></main>`;

    const copy = document.querySelector("#copy") as HTMLElement;
    const pageClickHandler = vi.fn();
    copy.addEventListener("click", pageClickHandler);

    const pipeline = attachEditModePointerPipeline({
      window: happyWindow as unknown as EditModeEventWindow,
      document,
      onPointerDown: () => undefined,
      onPointerMove: () => undefined,
      onPointerUp: () => undefined,
      onPointerCancel: () => undefined,
    });

    const event = new happyWindow.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    copy.dispatchEvent(event as unknown as Event);

    expect(event.defaultPrevented).toBe(false);
    expect(pageClickHandler).toHaveBeenCalled();

    pipeline.detach();
  });

  it("suppresses Enter and Space activation for page links and buttons", () => {
    const happyWindow = new Window({ innerWidth: 1024, innerHeight: 768 });
    const document = happyWindow.document as unknown as Document;
    document.body.innerHTML = `<main><a id="link" href="/x">Go</a><button id="button">Save</button></main>`;

    const link = document.querySelector("#link") as HTMLAnchorElement;
    const button = document.querySelector("#button") as HTMLButtonElement;
    const keyHandler = vi.fn();
    link.addEventListener("keydown", keyHandler);
    button.addEventListener("keyup", keyHandler);

    const pipeline = attachEditModePointerPipeline({
      window: happyWindow as unknown as EditModeEventWindow,
      document,
      onPointerDown: () => undefined,
      onPointerMove: () => undefined,
      onPointerUp: () => undefined,
      onPointerCancel: () => undefined,
    });

    const enter = new happyWindow.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    link.dispatchEvent(enter as unknown as Event);
    expect(enter.defaultPrevented).toBe(true);

    const space = new happyWindow.KeyboardEvent("keyup", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(space as unknown as Event);
    expect(space.defaultPrevented).toBe(true);
    expect(keyHandler).not.toHaveBeenCalled();

    pipeline.detach();
  });
});
