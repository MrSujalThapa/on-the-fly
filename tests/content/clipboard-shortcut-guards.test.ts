import { describe, expect, it } from "vitest";
import { createTestDocument } from "../editor/dom/test-document.js";

function isTextEntryElement(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") {
    return true;
  }

  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(type);
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }

  return element.closest("[contenteditable='true'], [contenteditable='plaintext-only']") !== null;
}

function shouldIgnoreClipboardShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return isTextEntryElement(target);
}

describe("clipboard shortcut guards", () => {
  it("ignores copy/paste shortcuts while typing in inputs", () => {
    const { document } = createTestDocument(`<main><input class="name" value="Ada" /></main>`);
    const input = document.querySelector("input") as HTMLInputElement;
    expect(shouldIgnoreClipboardShortcut(input)).toBe(true);
  });

  it("ignores copy/paste shortcuts in contenteditable text", () => {
    const { document } = createTestDocument(`<main><p contenteditable="true">Edit me</p></main>`);
    const paragraph = document.querySelector("p") as HTMLElement;
    expect(shouldIgnoreClipboardShortcut(paragraph)).toBe(true);
  });

  it("allows copy/paste shortcuts on normal page elements", () => {
    const { document } = createTestDocument(`<main><div class="card">Card</div></main>`);
    const card = document.querySelector(".card") as HTMLElement;
    expect(shouldIgnoreClipboardShortcut(card)).toBe(false);
  });
});
