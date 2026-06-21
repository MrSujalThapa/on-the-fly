import { describe, expect, it, vi } from "vitest";
import {
  isUsefulContainer,
  resolveRectangleDomElements,
  scoreRectangleCandidate,
} from "../../../src/editor/selection/dom-rectangle-selection.js";
import { createTestDocument } from "../dom/test-document.js";
import { layoutElement } from "../measurement/layout-helpers.js";

const VIEWPORT = { width: 1000, height: 800 };

function stubPointsToTopElement(
  document: Document,
  resolver: (x: number, y: number) => Element[],
): void {
  document.elementsFromPoint = vi.fn(resolver);
}

describe("isUsefulContainer", () => {
  it("recognises semantic, interactive, role and class/id hints", () => {
    const { root } = createTestDocument(`
      <article id="article"></article>
      <li id="li"></li>
      <a id="anchor" href="#"></a>
      <button id="button"></button>
      <div id="role" role="listitem"></div>
      <div id="hint" class="feed-item notification-row"></div>
      <div id="plain"></div>
      <span id="span"></span>
    `);

    const get = (id: string): Element => root.querySelector(`#${id}`) as Element;

    expect(isUsefulContainer(get("article"))).toBe(true);
    expect(isUsefulContainer(get("li"))).toBe(true);
    expect(isUsefulContainer(get("anchor"))).toBe(true);
    expect(isUsefulContainer(get("button"))).toBe(true);
    expect(isUsefulContainer(get("role"))).toBe(true);
    expect(isUsefulContainer(get("hint"))).toBe(true);
    expect(isUsefulContainer(get("plain"))).toBe(false);
    expect(isUsefulContainer(get("span"))).toBe(false);
  });
});

describe("scoreRectangleCandidate", () => {
  it("rejects giant page-level wrappers", () => {
    const { root } = createTestDocument(`<div id="wrap"><p id="copy">x</p></div>`);
    const wrap = root.querySelector("#wrap") as HTMLElement;
    layoutElement(wrap, { x: 0, y: 0, width: 990, height: 780 });

    const score = scoreRectangleCandidate(
      wrap,
      { x: 100, y: 100, width: 120, height: 80 },
      [wrap],
      VIEWPORT,
    );

    expect(score).toBeNull();
  });

  it("rejects candidates with no overlap with the rectangle", () => {
    const { root } = createTestDocument(`<li id="row">x</li>`);
    const row = root.querySelector("#row") as HTMLElement;
    layoutElement(row, { x: 500, y: 500, width: 200, height: 60 });

    const score = scoreRectangleCandidate(
      row,
      { x: 10, y: 10, width: 120, height: 80 },
      [row],
      VIEWPORT,
    );

    expect(score).toBeNull();
  });
});

describe("resolveRectangleDomElements", () => {
  it("maps a sampled span inside an anchor up to the anchor", () => {
    const { document, root } = createTestDocument(`
      <div id="bar"><a id="link" href="#"><span id="label">Open</span></a></div>
    `);
    const anchor = root.querySelector("#link") as HTMLElement;
    const span = root.querySelector("#label") as HTMLElement;
    layoutElement(anchor, { x: 40, y: 40, width: 120, height: 36 });
    layoutElement(span, { x: 48, y: 48, width: 90, height: 20 });

    stubPointsToTopElement(document, () => [span, anchor, root, document.body, document.documentElement]);

    const result = resolveRectangleDomElements(
      document,
      { x: 42, y: 42, width: 116, height: 32 },
      VIEWPORT,
    );

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.id).toBe("link");
  });

  it("maps notification-style list rows to their row containers", () => {
    const { document, root } = createTestDocument(`
      <ul id="feed">
        <li id="row-1" class="notification-item">
          <div class="avatar"></div>
          <span id="text-1">Alice reacted</span>
        </li>
        <li id="row-2" class="notification-item">
          <div class="avatar"></div>
          <span id="text-2">Bob commented</span>
        </li>
      </ul>
    `);
    const row1 = root.querySelector("#row-1") as HTMLElement;
    const row2 = root.querySelector("#row-2") as HTMLElement;
    const text1 = root.querySelector("#text-1") as HTMLElement;
    const text2 = root.querySelector("#text-2") as HTMLElement;
    layoutElement(row1, { x: 20, y: 20, width: 360, height: 60 });
    layoutElement(row2, { x: 20, y: 90, width: 360, height: 60 });
    layoutElement(text1, { x: 80, y: 30, width: 260, height: 24 });
    layoutElement(text2, { x: 80, y: 100, width: 260, height: 24 });

    stubPointsToTopElement(document, (_x, y) => {
      if (y < 85) {
        return [text1, row1, root, document.body, document.documentElement];
      }
      return [text2, row2, root, document.body, document.documentElement];
    });

    const result = resolveRectangleDomElements(
      document,
      { x: 18, y: 18, width: 366, height: 136 },
      VIEWPORT,
    );

    const ids = result.elements.map((element) => element.id).sort();
    expect(ids).toEqual(["row-1", "row-2"]);
  });

  it("selects deeply nested DOM without any VisualNode/graph", () => {
    const { document, root } = createTestDocument(`
      <section id="card" class="result-card">
        <div class="card-body">
          <div class="card-inner">
            <h3 id="heading">Result</h3>
            <p id="body-copy">Some description text here</p>
          </div>
        </div>
      </section>
    `);
    const card = root.querySelector("#card") as HTMLElement;
    const heading = root.querySelector("#heading") as HTMLElement;
    const copy = root.querySelector("#body-copy") as HTMLElement;
    layoutElement(card, { x: 30, y: 30, width: 320, height: 200 });
    layoutElement(heading, { x: 46, y: 46, width: 200, height: 28 });
    layoutElement(copy, { x: 46, y: 90, width: 280, height: 80 });

    stubPointsToTopElement(document, (_x, y) => {
      if (y < 80) {
        return [heading, card, root, document.body, document.documentElement];
      }
      return [copy, card, root, document.body, document.documentElement];
    });

    const result = resolveRectangleDomElements(
      document,
      { x: 28, y: 28, width: 324, height: 204 },
      VIEWPORT,
    );

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.id).toBe("card");
    expect(result.stats.rejectionReason).toBeUndefined();
  });

  it("rejects huge wrappers and keeps the inner card", () => {
    const { document, root } = createTestDocument(`
      <div id="page" class="layout">
        <main id="main">
          <article id="post" class="post-card">
            <p id="post-text">Body</p>
          </article>
        </main>
      </div>
    `);
    const page = root.querySelector("#page") as HTMLElement;
    const main = root.querySelector("#main") as HTMLElement;
    const post = root.querySelector("#post") as HTMLElement;
    const text = root.querySelector("#post-text") as HTMLElement;
    layoutElement(page, { x: 0, y: 0, width: 980, height: 770 });
    layoutElement(main, { x: 0, y: 0, width: 980, height: 770 });
    layoutElement(post, { x: 40, y: 40, width: 320, height: 160 });
    layoutElement(text, { x: 56, y: 56, width: 280, height: 40 });

    stubPointsToTopElement(document, () => [
      text,
      post,
      main,
      page,
      root,
      document.body,
      document.documentElement,
    ]);

    const result = resolveRectangleDomElements(
      document,
      { x: 38, y: 38, width: 324, height: 164 },
      VIEWPORT,
    );

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.id).toBe("post");
  });

  it("does not reject a small rectangle that selects sparse-page elements", () => {
    const { document, root } = createTestDocument(`
      <main><p id="a">One</p><p id="b">Two</p></main>
    `);
    const first = root.querySelector("#a") as HTMLElement;
    const second = root.querySelector("#b") as HTMLElement;
    layoutElement(first, { x: 20, y: 20, width: 80, height: 24 });
    layoutElement(second, { x: 20, y: 60, width: 80, height: 24 });

    stubPointsToTopElement(document, (_x, y) => {
      if (y < 45) {
        return [first, root, document.body, document.documentElement];
      }
      return [second, root, document.body, document.documentElement];
    });

    const result = resolveRectangleDomElements(
      document,
      { x: 10, y: 10, width: 120, height: 90 },
      VIEWPORT,
    );

    const ids = result.elements.map((element) => element.id).sort();
    expect(ids).toEqual(["a", "b"]);
    expect(result.stats.rejectionReason).toBeUndefined();
  });
});
