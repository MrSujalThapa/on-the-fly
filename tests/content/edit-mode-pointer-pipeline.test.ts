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
    happyWindow.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(clickHandler).not.toHaveBeenCalled();

    pipeline.detach();
  });
});
