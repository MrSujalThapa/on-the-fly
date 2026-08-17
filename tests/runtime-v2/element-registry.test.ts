import { describe, expect, it } from "vitest";
import { createTestDocument } from "../editor/dom/test-document.js";
import { createElementRegistry } from "../../src/runtime-v2/create-element-registry.js";
import { isAmbiguousTarget, isResolvedElement, isUnresolvedTarget } from "../../src/runtime-v2/element-registry.js";

describe("ElementRegistry", () => {
  it("registers repeated sibling cards uniquely", () => {
    const { document, root } = createTestDocument(`
      <section>
        <article class="card">Card</article>
        <article class="card">Card</article>
        <article class="card">Card</article>
        <article class="card">Card</article>
      </section>
    `);
    const cards = Array.from(root.querySelectorAll("article"));
    const third = cards[2];
    expect(third).toBeInstanceOf(document.defaultView?.HTMLElement ?? HTMLElement);
    if (!(third instanceof HTMLElement)) {
      return;
    }

    const registry = createElementRegistry(document);
    const handle = registry.register(third);
    expect(handle.signature.cssPath).toContain(":nth-of-type(3)");

    const resolved = registry.resolve(handle);
    expect(isResolvedElement(resolved)).toBe(true);
    if (isResolvedElement(resolved)) {
      expect(resolved.element).toBe(third);
    }
  });

  it("does not resolve an identical-class sibling as the registered card", () => {
    const { document, root } = createTestDocument(`
      <div>
        <p class="item">Alpha</p>
        <p class="item">Alpha</p>
      </div>
    `);
    const items = Array.from(root.querySelectorAll("p"));
    const first = items[0];
    const second = items[1];
    if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) {
      return;
    }

    const registry = createElementRegistry(document);
    const handle = registry.register(first);
    const resolved = registry.resolve(handle);
    expect(isResolvedElement(resolved)).toBe(true);
    if (isResolvedElement(resolved)) {
      expect(resolved.element).toBe(first);
      expect(resolved.element).not.toBe(second);
    }
  });

  it("distinguishes nearly identical text via nth-of-type", () => {
    const { document, root } = createTestDocument(`
      <ul>
        <li class="row">Hello world</li>
        <li class="row">Hello world!</li>
      </ul>
    `);
    const rows = Array.from(root.querySelectorAll("li"));
    const second = rows[1];
    if (!(second instanceof HTMLElement)) {
      return;
    }

    const registry = createElementRegistry(document);
    const handle = registry.register(second);
    const resolved = registry.resolve(handle);
    expect(isResolvedElement(resolved)).toBe(true);
    if (isResolvedElement(resolved)) {
      expect(resolved.element).toBe(second);
    }
  });

  it("resolves nested repeated structures to the inner target", () => {
    const { document, root } = createTestDocument(`
      <div class="list">
        <div class="group">
          <article class="card"><span>A</span></article>
          <article class="card"><span>B</span></article>
        </div>
        <div class="group">
          <article class="card"><span>C</span></article>
          <article class="card"><span>D</span></article>
        </div>
      </div>
    `);
    const inner = root.querySelectorAll("article")[3];
    if (!(inner instanceof HTMLElement)) {
      return;
    }

    const registry = createElementRegistry(document);
    const handle = registry.register(inner);
    const resolved = registry.resolve(handle);
    expect(isResolvedElement(resolved)).toBe(true);
    if (isResolvedElement(resolved)) {
      expect(resolved.element).toBe(inner);
      expect(resolved.element.textContent).toContain("D");
    }
  });

  it("invalidates a disconnected cache and re-resolves a replacement node", () => {
    const { document, root } = createTestDocument(`
      <div id="host"><article class="card">One</article></div>
    `);
    const host = root.querySelector("#host");
    const original = root.querySelector("article");
    if (!(host instanceof HTMLElement) || !(original instanceof HTMLElement)) {
      return;
    }

    const registry = createElementRegistry(document);
    const handle = registry.register(original);
    original.remove();

    const replacement = document.createElement("article");
    replacement.className = "card";
    replacement.textContent = "Two";
    host.append(replacement);

    registry.invalidate(handle);
    const resolved = registry.resolve(handle);
    expect(isResolvedElement(resolved)).toBe(true);
    if (isResolvedElement(resolved)) {
      expect(resolved.element).toBe(replacement);
      expect(resolved.element.isConnected).toBe(true);
    }
  });

  it("returns unresolved when the unique path matches nothing", () => {
    const { document, root } = createTestDocument(`<article class="card">Gone</article>`);
    const card = root.querySelector("article");
    if (!(card instanceof HTMLElement)) {
      return;
    }

    const registry = createElementRegistry(document);
    const handle = registry.register(card);
    card.remove();
    registry.invalidate(handle);

    const resolved = registry.resolve(handle);
    expect(isUnresolvedTarget(resolved)).toBe(true);
    expect(isAmbiguousTarget(resolved)).toBe(false);
  });

  it("returns ambiguous when durable identity matches multiple candidates", () => {
    const { document, root } = createTestDocument(`
      <div>
        <section id="dup">One</section>
        <section id="dup">Two</section>
      </div>
    `);
    const first = root.querySelector("section");
    if (!(first instanceof HTMLElement)) {
      return;
    }

    const registry = createElementRegistry(document);
    const handle = registry.register(first);
    registry.invalidate(handle);

    const resolved = registry.resolve(handle);
    expect(isAmbiguousTarget(resolved)).toBe(true);
    if (isAmbiguousTarget(resolved)) {
      expect(resolved.candidateCount).toBeGreaterThan(1);
    }
  });
});
