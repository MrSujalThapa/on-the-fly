import { describe, expect, it } from "vitest";
import {
  isInteractiveElement,
  requiresTransformOnlyMove,
} from "../../../src/editor/dom/interactive-safety.js";
import { createTestDocument } from "./test-document.js";

describe("interactive safety detection", () => {
  it("detects buttons, links, inputs, roles, contenteditable, aria state, and control hints", () => {
    const { root } = createTestDocument(`
      <main>
        <button id="btn">Save</button>
        <a id="link" href="/settings">Settings</a>
        <input id="field" />
        <div id="role-tab" role="tab">Overview</div>
        <div id="aria-radio" role="radio" aria-checked="false">Jobs</div>
        <div id="hint" class="nav-item">Experience</div>
        <div id="plain">Copy</div>
      </main>
    `);

    const interactive = [
      root.querySelector("#btn"),
      root.querySelector("#link"),
      root.querySelector("#field"),
      root.querySelector("#role-tab"),
      root.querySelector("#aria-radio"),
      root.querySelector("#hint"),
    ] as HTMLElement[];

    for (const element of interactive) {
      expect(isInteractiveElement(element)).toBe(true);
      expect(requiresTransformOnlyMove(element)).toBe(true);
    }

    expect(isInteractiveElement(root.querySelector("#plain") as HTMLElement)).toBe(false);
  });

  it("detects inline click handlers", () => {
    const { root } = createTestDocument(`<main><div id="clickable">Tap</div></main>`);
    const clickable = root.querySelector("#clickable") as HTMLElement;
    clickable.setAttribute("onclick", "return false");

    expect(isInteractiveElement(clickable)).toBe(true);
  });
});
