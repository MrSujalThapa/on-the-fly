import { describe, expect, it } from "vitest";
import { createTestDocument } from "../editor/dom/test-document.js";
import { buildCssPath, buildUniqueCssPath } from "../../src/editor/measurement/signature-builder.js";

describe("buildUniqueCssPath", () => {
  it("keeps nth-of-type for identical class siblings that share a class-only path", () => {
    const { root } = createTestDocument(`
      <section>
        <article class="card">One</article>
        <article class="card">Two</article>
        <article class="card">Three</article>
      </section>
    `);
    const third = root.querySelectorAll("article")[2];
    if (!(third instanceof HTMLElement)) {
      return;
    }

    expect(buildCssPath(third)).not.toContain(":nth-of-type(3)");
    expect(buildUniqueCssPath(third)).toContain(":nth-of-type(3)");
  });

  it("builds unique paths for the repeated-cards fixture", () => {
    const { document, root } = createTestDocument(`
      <main>
        <h1>Repeated cards</h1>
        <section class="row">
          <article class="card">Card</article>
          <article class="card">Card</article>
          <article class="card">Card</article>
          <article class="card">Card</article>
        </section>
      </main>
    `);
    const cards = Array.from(root.querySelectorAll("article"));
    const paths = cards.map((card) => buildUniqueCssPath(card, document));
    expect(new Set(paths).size).toBe(4);
    const matches = paths.map((path) => document.querySelectorAll(path).length);
    expect(matches).toEqual([1, 1, 1, 1]);
  });
});
