import { describe, expect, it } from "vitest";
import { createTestDocument } from "../editor/dom/test-document.js";
import { createVisualModel } from "../../src/runtime-v2/create-visual-model.js";
import { isResolvedVisual, isUnresolvedVisual } from "../../src/runtime-v2/visual-model.js";
import { buildDurableIdentity, identifyingContent, resolveDurableIdentity } from "../../src/runtime-v2/visual-identity.js";
import { discoverFromElement } from "../../src/runtime-v2/visual-hierarchy.js";

function stubRect(
  element: HTMLElement,
  rect: { x: number; y: number; width: number; height: number },
): void {
  element.getBoundingClientRect = () => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON() {
      return this;
    },
  });
}

function layoutCards(root: HTMLElement, selector: string, y = 80): HTMLElement[] {
  const cards = Array.from(root.querySelectorAll(selector)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
  cards.forEach((card, index) => {
    stubRect(card, { x: 40 + index * 220, y, width: 200, height: 140 });
  });
  const parent = cards[0]?.parentElement;
  if (parent instanceof HTMLElement && cards.length > 0) {
    const last = cards[cards.length - 1];
    stubRect(parent, {
      x: 20,
      y: y - 20,
      width: (last ? last.getBoundingClientRect().right : 200) + 20,
      height: 180,
    });
  }
  return cards;
}

describe("VisualModel identity", () => {
  it("registers repeated sibling cards uniquely", () => {
    const { document, root } = createTestDocument(`
      <section>
        <article class="card">Card</article>
        <article class="card">Card</article>
        <article class="card">Card</article>
        <article class="card">Card</article>
      </section>
    `);
    const cards = layoutCards(root, "article");
    const third = cards[2];
    if (!third) {
      return;
    }
    const model = createVisualModel(document);
    const id = model.adopt(third);
    expect(id).toBeTruthy();
    if (!id) {
      return;
    }
    const resolved = model.resolveNode(id);
    expect(isResolvedVisual(resolved)).toBe(true);
    if (isResolvedVisual(resolved)) {
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
    const items = layoutCards(root, "p");
    const first = items[0];
    const second = items[1];
    if (!first || !second) {
      return;
    }
    const model = createVisualModel(document);
    const id = model.adopt(first);
    expect(id).toBeTruthy();
    if (!id) {
      return;
    }
    const resolved = model.resolveNode(id);
    expect(isResolvedVisual(resolved)).toBe(true);
    if (isResolvedVisual(resolved)) {
      expect(resolved.element).toBe(first);
      expect(resolved.element).not.toBe(second);
    }
  });

  it("rebinds an equivalent DOM replacement via logical keys", () => {
    const { document, root } = createTestDocument(`
      <div id="host"><article class="card" data-logical-id="item-a">One</article></div>
    `);
    const host = root.querySelector("#host");
    const original = root.querySelector("article");
    if (!(host instanceof HTMLElement) || !(original instanceof HTMLElement)) {
      return;
    }
    stubRect(original, { x: 20, y: 20, width: 200, height: 80 });
    const model = createVisualModel(document);
    const id = model.adopt(original);
    expect(id).toBeTruthy();
    if (!id) {
      return;
    }
    const identity = model.durableIdentityOf(id);
    expect(identity).toBeTruthy();
    original.remove();
    const replacement = document.createElement("article");
    replacement.className = "card";
    replacement.dataset.logicalId = "item-a";
    replacement.textContent = "Two";
    host.append(replacement);
    stubRect(replacement, { x: 20, y: 20, width: 200, height: 80 });
    model.invalidate(id);
    const resolved = identity ? model.resolveIdentity(identity) : null;
    expect(resolved && isResolvedVisual(resolved)).toBe(true);
    if (resolved && isResolvedVisual(resolved)) {
      expect(resolved.element).toBe(replacement);
    }
  });

  it("returns unresolved when the target is permanently removed", () => {
    const { document, root } = createTestDocument(`<article class="card" data-logical-id="gone">Gone</article>`);
    const card = root.querySelector("article");
    if (!(card instanceof HTMLElement)) {
      return;
    }
    stubRect(card, { x: 10, y: 10, width: 120, height: 80 });
    const identity = buildDurableIdentity(card, document);
    card.remove();
    const resolved = resolveDurableIdentity(document, identity);
    expect(isUnresolvedVisual(resolved)).toBe(true);
  });

  it("does not retarget a unique css path after a sibling is inserted before the logical item", () => {
    const { document, root } = createTestDocument(`
      <ul>
        <li data-logical-id="a">Alpha notice</li>
        <li data-logical-id="b">Bravo notice</li>
        <li data-logical-id="c">Charlie notice</li>
      </ul>
    `);
    const items: HTMLElement[] = [];
    for (const node of Array.from(root.querySelectorAll("li"))) {
      if (node instanceof HTMLElement) {
        items.push(node);
      }
    }
    layoutCards(root, "li");
    const bravo = items[1];
    if (!bravo) {
      return;
    }
    const identity = buildDurableIdentity(bravo, document);
    const inserted = document.createElement("li");
    inserted.dataset.logicalId = "new";
    inserted.textContent = "New notice";
    bravo.parentElement?.insertBefore(inserted, bravo);
    layoutCards(root, "li");
    const resolved = resolveDurableIdentity(document, identity);
    expect(isResolvedVisual(resolved)).toBe(true);
    if (isResolvedVisual(resolved)) {
      expect(resolved.element).toBe(bravo);
      expect(resolved.element.dataset.logicalId).toBe("b");
    }
  });
});

describe("VisualModel hierarchy", () => {
  it("collapses an anchor wrapper and content into one unit", () => {
    const { root } = createTestDocument(`
      <div class="gallery">
        <div class="item">
          <a href="/x">
            <article class="card">
              <img alt="shot" />
              <h2>Title</h2>
              <footer>Meta</footer>
            </article>
          </a>
        </div>
        <div class="item">
          <a href="/y">
            <article class="card">
              <img alt="shot2" />
              <h2>Other</h2>
              <footer>Meta</footer>
            </article>
          </a>
        </div>
      </div>
    `);
    const items = Array.from(root.querySelectorAll(".item")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    layoutCards(root, ".item");
    const image = root.querySelector("img");
    const title = root.querySelector("h2");
    const footer = root.querySelector("footer");
    if (!(image instanceof HTMLElement) || !(title instanceof HTMLElement) || !(footer instanceof HTMLElement)) {
      return;
    }
    const first = items[0];
    if (!first) {
      return;
    }
    stubRect(image, { x: 50, y: 90, width: 160, height: 40 });
    stubRect(title, { x: 50, y: 140, width: 160, height: 24 });
    stubRect(footer, { x: 50, y: 170, width: 160, height: 20 });
    const fromImage = discoverFromElement(image);
    const fromTitle = discoverFromElement(title);
    const fromFooter = discoverFromElement(footer);
    expect(fromImage?.binding).toBe(first);
    expect(fromTitle?.binding).toBe(first);
    expect(fromFooter?.binding).toBe(first);
    expect(fromImage?.parentRole).toBe("collection");
  });

  it("does not treat the collection as the default unit", () => {
    const { document, root } = createTestDocument(`
      <section class="row">
        <article class="card">A</article>
        <article class="card">B</article>
        <article class="card">C</article>
      </section>
    `);
    const cards = layoutCards(root, "article");
    const middle = cards[1];
    if (!middle) {
      return;
    }
    const model = createVisualModel(document);
    const id = model.adopt(middle);
    expect(id).toBeTruthy();
    if (!id) {
      return;
    }
    expect(model.get(id)?.role).toBe("unit");
    const parentId = model.parentOf(id);
    expect(parentId).toBeTruthy();
    if (!parentId) {
      return;
    }
    expect(model.get(parentId)?.role).toBe("collection");
    expect(model.bind(id)).toBe(middle);
  });
});

describe("logical identity vs positional locators", () => {
  it("resolves Mentions after reorder instead of the sibling now occupying the old path", () => {
    const { document, root } = createTestDocument(`
      <nav class="tabs">
        <button class="tab">All</button>
        <button class="tab">Jobs</button>
        <button class="tab">My posts</button>
        <button class="tab">Mentions</button>
      </nav>
    `);
    const tabs = layoutCards(root, "button", 40);
    const mentions = tabs[3];
    if (!mentions) {
      return;
    }
    const identity = buildDurableIdentity(mentions, document);
    const nav = root.querySelector("nav");
    if (!(nav instanceof HTMLElement) || !tabs[0] || !tabs[1] || !tabs[2]) {
      return;
    }
    nav.append(tabs[2], tabs[0], mentions, tabs[1]);
    layoutCards(root, "button", 40);
    const resolved = resolveDurableIdentity(document, identity);
    expect(isResolvedVisual(resolved)).toBe(true);
    if (isResolvedVisual(resolved)) {
      expect(identifyingContent(resolved.element.textContent || "")).toBe("mentions");
      expect(identifyingContent(resolved.element.textContent || "")).not.toBe("my posts");
    }
  });

  it("does not accept a unique css path whose identifying content contradicts the saved target", () => {
    const { document, root } = createTestDocument(`
      <div>
        <button class="tab">A</button>
        <button class="tab">B</button>
        <button class="tab">C</button>
        <button class="tab">D</button>
      </div>
    `);
    const tabs = layoutCards(root, "button", 40);
    const c = tabs[2];
    if (!c) {
      return;
    }
    const identity = buildDurableIdentity(c, document);
    const host = root.querySelector("div");
    if (!(host instanceof HTMLElement) || !tabs[0] || !tabs[1] || !tabs[3]) {
      return;
    }
    host.append(tabs[3], tabs[0], tabs[1], c);
    layoutCards(root, "button", 40);
    const resolved = resolveDurableIdentity(document, identity);
    expect(isResolvedVisual(resolved)).toBe(true);
    if (isResolvedVisual(resolved)) {
      expect(identifyingContent(resolved.element.textContent || "")).toBe("c");
    }
  });

  it("still resolves a control after generated data-id values change", () => {
    const { document, root } = createTestDocument(`
      <div role="radiogroup">
        <button role="radio" data-id="ember1">All</button>
        <button role="radio" data-id="ember2">Jobs</button>
        <button role="radio" data-id="ember3">My posts</button>
        <button role="radio" data-id="ember4">Mentions</button>
      </div>
    `);
    const tabs = layoutCards(root, "button", 40);
    const mentions = tabs[3];
    if (!mentions) {
      return;
    }
    const identity = buildDurableIdentity(mentions, document);
    mentions.dataset.id = "ember88";
    const resolved = resolveDurableIdentity(document, identity);
    expect(isResolvedVisual(resolved)).toBe(true);
    if (isResolvedVisual(resolved)) {
      expect(identifyingContent(resolved.element.textContent || "")).toBe("mentions");
    }
  });

  it("ignores an embedded Ember suffix when rebinding an interactive control", () => {
    const { document, root } = createTestDocument(`
      <button id="nt-card-settings-dropdown-trigger-ember36" aria-label="Settings menu">...</button>
    `);
    const button = root.querySelector("button");
    if (!(button instanceof HTMLElement)) {
      return;
    }
    layoutCards(root, "button", 40);
    const identity = buildDurableIdentity(button, document);
    button.id = "nt-card-settings-dropdown-trigger-ember99";
    const resolved = resolveDurableIdentity(document, identity);
    expect(isResolvedVisual(resolved)).toBe(true);
    if (isResolvedVisual(resolved)) {
      expect(resolved.element).toBe(button);
    }
  });

  it("keeps the exact connected live binding authoritative when identity evidence changes", () => {
    const { document, root } = createTestDocument(`<button id="ember1" aria-label="Settings menu">Menu</button>`);
    const button = root.querySelector("button");
    if (!(button instanceof HTMLElement)) {
      return;
    }
    layoutCards(root, "button", 40);
    const model = createVisualModel(document);
    const nodeId = model.adopt(button);
    expect(nodeId).not.toBeNull();
    if (!nodeId) {
      return;
    }
    button.id = "ember999";
    button.setAttribute("aria-label", "Updated settings menu");
    const resolved = model.resolveNode(nodeId);
    expect(isResolvedVisual(resolved)).toBe(true);
    if (isResolvedVisual(resolved)) {
      expect(resolved.element).toBe(button);
      expect(resolved.evidence.strategy).toBe("live-cache");
    }
  });

  it("rebinds distinct persisted children exactly instead of promoting both to their card", () => {
    const { document, root } = createTestDocument(`
      <article><a><img src="avatar.png" /></a><button aria-label="Settings menu">...</button></article>
    `);
    const image = root.querySelector("img");
    const button = root.querySelector("button");
    if (!(image instanceof HTMLElement) || !(button instanceof HTMLElement)) {
      return;
    }
    layoutCards(root, "article, img, button", 40);
    const model = createVisualModel(document);
    const imageResult = model.resolveIdentity(buildDurableIdentity(image, document));
    const buttonResult = model.resolveIdentity(buildDurableIdentity(button, document));
    expect(isResolvedVisual(imageResult)).toBe(true);
    expect(isResolvedVisual(buttonResult)).toBe(true);
    if (isResolvedVisual(imageResult) && isResolvedVisual(buttonResult)) {
      expect(imageResult.element).toBe(image);
      expect(buttonResult.element).toBe(button);
      expect(imageResult.nodeId).not.toBe(buttonResult.nodeId);
      expect(imageResult.nodeId && model.bind(imageResult.nodeId)).toBe(image);
      expect(buttonResult.nodeId && model.bind(buttonResult.nodeId)).toBe(button);
    }
  });
});
