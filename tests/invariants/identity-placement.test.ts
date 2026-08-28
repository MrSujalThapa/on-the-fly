import { describe, expect, it } from "vitest";
import { pageKeyFromUrl } from "../../src/content/page-identity.js";
import { buildCssPath, buildUniqueCssPath } from "../../src/editor/measurement/signature-builder.js";
import { createPlacementEngine } from "../../src/runtime-v2/create-placement-engine.js";
import { createVisualModel } from "../../src/runtime-v2/create-visual-model.js";
import { createTestDocument } from "../editor/dom/test-document.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";

function stubRect(element: HTMLElement, rect: { x: number; y: number; width: number; height: number }): void {
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

describe("identity", () => {
  it("builds unique css paths for identical class siblings", () => {
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
    if (!(third instanceof HTMLElement)) return;
    expect(buildCssPath(third)).not.toContain(":nth-of-type(3)");
    expect(buildUniqueCssPath(third)).toContain(":nth-of-type(3)");
    const paths = cards.map((card) => buildUniqueCssPath(card, document));
    expect(new Set(paths).size).toBe(4);
    expect(paths.map((path) => document.querySelectorAll(path).length)).toEqual([1, 1, 1, 1]);
  });

  it("uses cloneId as the sole live clone identity and rejects a second live owner", () => {
    const { document, root } = createTestDocument(
      `<h1 data-otf-clone-id="clone-a">A</h1><h1 data-otf-clone-id="clone-a">A again</h1>`,
    );
    const clones = Array.from(root.querySelectorAll("h1"));
    for (const [index, clone] of clones.entries()) {
      stubRect(clone, { x: 40 + index * 220, y: 80, width: 200, height: 40 });
    }
    const first = clones[0];
    const second = clones[1];
    if (!first || !second) return;
    const model = createVisualModel(document);
    expect(model.adopt(first)).toBe("clone-a");
    expect(model.adopt(second)).toBeNull();
    expect(model.bind("clone-a")).toBe(first);
  });

  it("keeps clone descendants distinct and scopes their durable path to the clone", () => {
    const { document, root } = createTestDocument('<section data-otf-clone-id="clone-a"><button>Title</button></section>');
    const clone = root.querySelector("section");
    const child = root.querySelector("button");
    if (!(clone instanceof HTMLElement) || !(child instanceof HTMLElement)) return;
    stubRect(clone, { x: 40, y: 80, width: 240, height: 80 });
    stubRect(child, { x: 60, y: 100, width: 100, height: 32 });
    const model = createVisualModel(document);
    const childId = model.adopt(child);
    expect(childId).not.toBeNull();
    if (!childId) return;
    expect(childId).not.toBe("clone-a");
    expect(model.bind(childId)).toBe(child);
    expect(model.durableIdentityOf(childId)?.signature.cssPath).toMatch(/^\[data-otf-clone-id="clone-a"\] >/u);
    expect(model.bind("clone-a")).toBe(clone);
  });

  it("ignores trailing slashes when deriving a page key", () => {
    expect(pageKeyFromUrl("https://example.com/notifications/")).toBe("https://example.com/notifications");
    expect(pageKeyFromUrl("https://example.com/notifications")).toBe("https://example.com/notifications");
  });
});

describe("placement", () => {
  it("prefers in-flow transform for ordinary elements and does not treat a link as interaction-safe-fixed", () => {
    const { root } = createTestDocument(`<article class="card">Card</article><a href="/x">Go</a>`);
    const article = root.querySelector("article") as HTMLElement;
    const link = root.querySelector("a") as HTMLElement;
    const engine = createPlacementEngine();
    expect(engine.planMove({
      element: article,
      currentRect: { x: 40, y: 80, width: 120, height: 60 },
      dx: 24,
      dy: 12,
    }).strategy).toBe("in-flow");
    expect(engine.planMove({
      element: link,
      currentRect: { x: 0, y: 0, width: 80, height: 20 },
      dx: 10,
      dy: 5,
    }).payload.interactionSafeFixed).toBe(false);
  });

  it("promotes an interactive child to independent placement when it leaves its parent", () => {
    const { root } = createTestDocument(
      `<section><div role="radiogroup"><button role="radio">Mentions</button></div></section>`,
    );
    const group = root.querySelector('[role="radiogroup"]') as HTMLElement;
    const child = root.querySelector('[role="radio"]') as HTMLElement;
    layoutElement(group, { x: 20, y: 20, width: 200, height: 60 });
    layoutElement(child, { x: 40, y: 30, width: 80, height: 30 });
    const plan = createPlacementEngine().planMove({
      element: child,
      currentRect: { x: 40, y: 30, width: 80, height: 30 },
      dx: 0,
      dy: 100,
    });
    expect(plan.strategy).toBe("detached");
    expect(plan.payload.detached).toBe(true);
    expect(plan.payload.detachedTop).toBe(130);
    expect(Number.parseInt(plan.payload.detachedZIndex ?? "0", 10)).toBeGreaterThan(100);
  });

  it("translates the live AABB for an already-independent element instead of recomputing it", () => {
    const { root } = createTestDocument(`<article class="card">Card</article>`);
    const article = root.querySelector("article") as HTMLElement;
    article.setAttribute("data-otf-detached", "true");
    const current = { x: 110, y: 20, width: 800, height: 910 };
    const plan = createPlacementEngine().planMove({
      element: article,
      currentRect: current,
      dx: -40,
      dy: 18,
    });
    expect(plan.expectedRect).toEqual({ x: 70, y: 38, width: 800, height: 910 });
    expect(plan.payload.detached).toBe(true);
  });
});
