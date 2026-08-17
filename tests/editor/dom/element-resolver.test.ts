import { describe, expect, it } from "vitest";
import { getElementResolver } from "../../../src/editor/dom/element-resolver.js";
import { buildPersistableElementSignature } from "../../../src/editor/measurement/signature-builder.js";
import { createTestDocument } from "./test-document.js";
import { layoutElement } from "../measurement/layout-helpers.js";

describe("ElementResolver", () => {
  it("resolves repeated sibling cards to the selected nth sibling", () => {
    const { document } = createTestDocument(
      `<main><section class="feed">
        <article class="card item"><h2>Project</h2><p>Description</p></article>
        <article class="card item"><h2>Project</h2><p>Description</p></article>
        <article class="card item"><h2>Project</h2><p>Description</p></article>
      </section></main>`,
    );
    const cards = Array.from(document.querySelectorAll(".card.item")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    cards.forEach((card, index) => {
      layoutElement(card, { x: 20, y: 40 + index * 160, width: 300, height: 140 });
    });
    const target = cards[1];
    if (!target) {
      throw new Error("missing card");
    }

    const signature = buildPersistableElementSignature(target, { root: document });
    expect(signature.cssPath).toContain(":nth-of-type(2)");

    const resolver = getElementResolver(document);
    const resolved = resolver.resolveDetailed(signature);
    expect(resolved.element).toBe(target);
    expect(resolved.diagnostics.resolved).toBe(true);
    expect(resolved.diagnostics.ambiguous).toBe(false);
  });

  it("rejects override elements that do not match the durable signature", () => {
    const { document } = createTestDocument(
      `<main>
        <article class="card" id="a">Alpha</article>
        <article class="card" id="b">Beta</article>
      </main>`,
    );
    const a = document.querySelector("#a") as HTMLElement;
    const b = document.querySelector("#b") as HTMLElement;
    layoutElement(a, { x: 10, y: 10, width: 100, height: 40 });
    layoutElement(b, { x: 10, y: 60, width: 100, height: 40 });

    const signature = buildPersistableElementSignature(a, { root: document });
    const resolver = getElementResolver(document);
    expect(resolver.verify(signature, a)).toBe(true);
    expect(resolver.verify(signature, b)).toBe(false);
  });

  it("re-resolves when a cached node is disconnected", () => {
    const { document } = createTestDocument(
      `<main><section class="panel"><h2>Settings</h2></section></main>`,
    );
    const original = document.querySelector(".panel") as HTMLElement;
    layoutElement(original, { x: 20, y: 20, width: 200, height: 120 });
    const signature = buildPersistableElementSignature(original, { root: document });
    const resolver = getElementResolver(document);
    expect(resolver.resolve(signature)).toBe(original);

    const replacement = original.cloneNode(true);
    if (!(replacement instanceof HTMLElement)) {
      throw new Error("clone failed");
    }
    layoutElement(replacement, { x: 20, y: 20, width: 200, height: 120 });
    original.replaceWith(replacement);

    const resolved = resolver.resolveDetailed(signature);
    expect(resolved.element).toBe(replacement);
    expect(original.isConnected).toBe(false);
  });
});
