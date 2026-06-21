import { describe, expect, it } from "vitest";
import { matchElementBySignature } from "../../../src/editor/dom/signature-matcher.js";
import { createEmptyBoundingBoxHint } from "../../../src/editor/element-signature.js";
import { createTestDocument } from "./test-document.js";

describe("matchElementBySignature", () => {
  it("matches an element using cssPath and tag metadata", () => {
    const { root } = createTestDocument(
      `<main><article><p class="intro" id="lead">Hello world</p><p class="intro">Other</p></article></main>`,
    );

    const matched = matchElementBySignature(root, {
      cssPath: "main article p.intro",
      tagName: "p",
      idAttr: "lead",
      classList: ["intro"],
      textFingerprint: "Hello world",
      boundingBoxHint: createEmptyBoundingBoxHint(),
    });

    expect(matched?.id).toBe("lead");
    expect(matched?.textContent).toBe("Hello world");
  });

  it("rejects dangerous selectors", () => {
    const { root } = createTestDocument(`<body><p>Hello</p></body>`);

    const matched = matchElementBySignature(root, {
      cssPath: "body",
      tagName: "body",
      classList: [],
      boundingBoxHint: createEmptyBoundingBoxHint(),
    });

    expect(matched).toBeNull();
  });
});
