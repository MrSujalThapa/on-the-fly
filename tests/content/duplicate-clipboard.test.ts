import { describe, expect, it } from "vitest";
import { DomRuntimeAdapter } from "../../src/editor/dom/dom-runtime-adapter.js";
import {
  captureEditorClipboard,
  createDuplicateOperations,
} from "../../src/editor/duplicate/duplicate-element.js";
import { createTestDocument } from "../editor/dom/test-document.js";

const PAGE_KEY = "https://example.com/";

describe("duplicate clipboard", () => {
  it("duplicates a single element with offset via operation apply", () => {
    const { document, root } = createTestDocument(
      `<main><div class="card">Hello</div></main>`,
    );
    const card = document.querySelector(".card");
    if (!(card instanceof HTMLElement)) {
      throw new Error("missing card");
    }
    card.getBoundingClientRect = () => ({
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      top: 20,
      left: 10,
      right: 110,
      bottom: 60,
      toJSON: () => ({}),
    });

    const entries = captureEditorClipboard(
      [
        {
          nodeId: "card",
          signature: {
            cssPath: "main div.card",
            tagName: "div",
            classList: ["card"],
            boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
          },
          rect: { x: 10, y: 20, width: 100, height: 40 },
          element: card,
        },
      ],
      (target) => target.element ?? card,
    );

    const { operations } = createDuplicateOperations(entries, PAGE_KEY, () => "dup-1");
    const adapter = new DomRuntimeAdapter(root);
    const results = adapter.replayOperations(operations);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(document.querySelectorAll("[data-otf-clone-id]")).toHaveLength(1);
    const clone = document.querySelector("[data-otf-clone-id]") as HTMLElement;
    expect(clone.parentElement).toBe(document.body);
    expect(clone.style.left).toBe("22px");
    expect(clone.style.top).toBe("32px");
    expect(Number(clone.style.zIndex)).toBeGreaterThan(0);
  });

  it("duplicates grouped selections", () => {
    const { document } = createTestDocument(
      `<main><div class="a">A</div><div class="b">B</div></main>`,
    );
    const aEl = document.querySelector(".a");
    const bEl = document.querySelector(".b");
    if (!(aEl instanceof HTMLElement) || !(bEl instanceof HTMLElement)) {
      throw new Error("missing elements");
    }
    const rect = { x: 0, y: 0, width: 50, height: 20 };
    for (const element of [aEl, bEl]) {
      element.getBoundingClientRect = () => ({
        ...rect,
        top: 0,
        left: 0,
        right: 50,
        bottom: 20,
        toJSON: () => ({}),
      });
    }

    const entries = captureEditorClipboard(
      [
        {
          nodeId: "a",
          signature: {
            cssPath: "main div.a",
            tagName: "div",
            classList: ["a"],
            boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
          },
          rect,
          element: aEl,
        },
        {
          nodeId: "b",
          signature: {
            cssPath: "main div.b",
            tagName: "div",
            classList: ["b"],
            boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
          },
          rect,
          element: bEl,
        },
      ],
      (target) => target.element ?? null,
    );

    const { operations } = createDuplicateOperations(entries, PAGE_KEY, () => "dup-group");
    expect(operations).toHaveLength(2);
    expect(document.querySelectorAll("[data-otf-clone-id]")).toHaveLength(0);
  });

  it("replays duplicate operations after refresh", () => {
    const { document, root } = createTestDocument(
      `<main><p class="copy">Copy me</p></main>`,
    );
    const copyEl = document.querySelector(".copy");
    if (!(copyEl instanceof HTMLElement)) {
      throw new Error("missing copy");
    }
    copyEl.getBoundingClientRect = () => ({
      x: 5,
      y: 5,
      width: 80,
      height: 20,
      top: 5,
      left: 5,
      right: 85,
      bottom: 25,
      toJSON: () => ({}),
    });

    const entries = captureEditorClipboard(
      [
        {
          nodeId: "copy",
          signature: {
            cssPath: "main p.copy",
            tagName: "p",
            classList: ["copy"],
            boundingBoxHint: { xRatio: 0, yRatio: 0, widthRatio: 0, heightRatio: 0 },
          },
          rect: { x: 5, y: 5, width: 80, height: 20 },
          element: copyEl,
        },
      ],
      (target) => target.element ?? copyEl,
    );

    const { operations } = createDuplicateOperations(entries, PAGE_KEY, () => "dup-replay");
    const adapter = new DomRuntimeAdapter(root);
    const results = adapter.replayOperations(operations);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(document.querySelectorAll("[data-otf-clone-id]")).toHaveLength(1);
  });
});
