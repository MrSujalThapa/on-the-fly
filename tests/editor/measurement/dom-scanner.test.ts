import { describe, expect, it } from "vitest";
import {
  buildCssPath,
  buildElementSignature,
} from "../../../src/editor/measurement/signature-builder.js";
import { detectElementKind } from "../../../src/editor/measurement/element-kind.js";
import {
  isExtensionRoot,
  shouldExcludeFromMeasurement,
  shouldSkipSubtree,
} from "../../../src/editor/measurement/scan-guards.js";
import { scanVisualNodes } from "../../../src/editor/measurement/dom-scanner.js";
import { createTestDocument } from "../dom/test-document.js";
import { layoutElement, layoutTree } from "./layout-helpers.js";

describe("measurement scanning and signatures", () => {
  it("builds css paths and signatures with metadata hints", () => {
    const { document, root } = createTestDocument(
      `<main><article><p class="intro" id="lead" role="note" aria-label="Lead copy">Hello world</p></article></main>`,
    );
    const paragraph = root.querySelector("#lead") as HTMLElement;
    layoutElement(paragraph, { x: 40, y: 60, width: 180, height: 24 });

    expect(buildCssPath(paragraph, document)).toContain("p#lead");
    expect(buildElementSignature(paragraph, { root: document }).textFingerprint).toBe("Hello world");
    expect(buildElementSignature(paragraph, { root: document }).role).toBe("note");
    expect(buildElementSignature(paragraph, { root: document }).boundingBoxHint.widthRatio).toBeGreaterThan(0);
  });

  it("detects common visual node kinds", () => {
    const { root } = createTestDocument(
      `<main><p>Text</p><img alt="Hero" /><button>Save</button><div><span>Nested</span></div></main>`,
    );
    layoutTree(root);

    const paragraph = root.querySelector("p");
    const image = root.querySelector("img");
    const button = root.querySelector("button");
    const container = root.querySelector("div");

    expect(paragraph).not.toBeNull();
    expect(image).not.toBeNull();
    expect(button).not.toBeNull();
    expect(container).not.toBeNull();
    expect(detectElementKind(paragraph as Element)).toBe("text");
    expect(detectElementKind(image as Element)).toBe("image");
    expect(detectElementKind(button as Element)).toBe("button");
    expect(detectElementKind(container as Element)).toBe("container");
  });

  it("excludes hidden, metadata, and extension-root nodes while scanning", () => {
    const { document, root } = createTestDocument(`
      <main>
        <p class="visible">Visible</p>
        <script>console.log("skip")</script>
        <style>.x{}</style>
        <meta name="viewport" content="width=device-width" />
        <p class="hidden" style="display:none">Hidden</p>
      </main>
    `);
    layoutTree(root);

    const extensionHost = document.createElement("div");
    extensionHost.id = "on-the-fly-root-host";
    extensionHost.setAttribute("data-on-the-fly", "root-host");
    document.documentElement.appendChild(extensionHost);

    expect(shouldSkipSubtree(root.querySelector("script") as Element)).toBe(true);
    expect(shouldSkipSubtree(root.querySelector("style") as Element)).toBe(true);
    expect(shouldSkipSubtree(root.querySelector("meta") as Element)).toBe(true);
    expect(isExtensionRoot(extensionHost)).toBe(true);
    expect(shouldExcludeFromMeasurement(document.documentElement)).toBe(true);

    const scanned = scanVisualNodes(document);
    const kinds = Array.from(scanned.nodes.values()).map((node) => node.kind);

    expect(kinds).toContain("text");
    expect(Array.from(scanned.nodes.values()).some((node) => node.signature.tagName === "script")).toBe(false);
    expect(Array.from(scanned.nodes.values()).some((node) => node.signature.tagName === "meta")).toBe(false);
    expect(
      Array.from(scanned.nodes.values()).some(
        (node) => node.signature.idAttr === "on-the-fly-root-host",
      ),
    ).toBe(false);
  });

  it("builds parent/child visual nodes from measurable DOM", () => {
    const { document } = createTestDocument(
      `<main><section><p class="intro">Hello</p><button>Go</button></section></main>`,
    );
    layoutTree(document.body);

    const scanned = scanVisualNodes(document);
    const paragraph = Array.from(scanned.nodes.values()).find(
      (node) => node.signature.classList.includes("intro"),
    );
    const section = Array.from(scanned.nodes.values()).find(
      (node) => node.signature.tagName === "section",
    );

    expect(paragraph).toBeDefined();
    expect(section).toBeDefined();
    expect(paragraph?.parentId).toBe(section?.id);
    if (paragraph && section) {
      expect(section.childIds).toContain(paragraph.id);
    }
    expect(paragraph?.rect.width).toBeGreaterThan(0);
    expect(paragraph?.computed.display).toBeTruthy();
  });
});
