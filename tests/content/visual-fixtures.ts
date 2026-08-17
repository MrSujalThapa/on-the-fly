import { createTestDocument } from "../editor/dom/test-document.js";
import {
  VisualLayoutWorld,
  type FlowSpec,
  type GeometryRect,
} from "./visual-movement-harness.js";

export interface VisualFixture {
  name: string;
  document: Document;
  world: VisualLayoutWorld;
  target: HTMLElement;
  parent: HTMLElement;
  siblings: HTMLElement[];
  importantRects: () => Record<string, GeometryRect>;
  restoreHost(): void;
  replaceTarget(): HTMLElement;
}

function requireElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`fixture missing ${selector}`);
  }
  return element;
}

function bindFlowColumn(
  world: VisualLayoutWorld,
  elements: HTMLElement[],
  origin: GeometryRect,
  gap: number,
  group: string,
): void {
  let y = origin.y;
  elements.forEach((element, index) => {
    const flow: FlowSpec = { group, index, axis: "y", gap };
    world.bind(element, { ...origin, y }, flow);
    y += origin.height + gap;
  });
}

function bindFlowRow(
  world: VisualLayoutWorld,
  elements: HTMLElement[],
  origin: GeometryRect,
  gap: number,
  group: string,
): void {
  let x = origin.x;
  elements.forEach((element, index) => {
    const flow: FlowSpec = { group, index, axis: "x", gap };
    world.bind(element, { ...origin, x }, flow);
    x += origin.width + gap;
  });
}

function createFixture(
  name: string,
  html: string,
  assemble: (document: Document, world: VisualLayoutWorld) => {
    target: HTMLElement;
    parent: HTMLElement;
    siblings: HTMLElement[];
    importantRects: () => Record<string, GeometryRect>;
  },
): VisualFixture {
  const { document } = createTestDocument(html);
  const world = new VisualLayoutWorld(document);
  const assembled = assemble(document, world);
  const state = {
    target: assembled.target,
    parent: assembled.parent,
    siblings: assembled.siblings,
  };
  const originalParent = state.target.parentElement;
  const originalNext = state.target.nextSibling;
  if (!originalParent) {
    throw new Error(`${name}: target has no parent`);
  }

  const fixture: VisualFixture = {
    name,
    document,
    world,
    get target() {
      return state.target;
    },
    get parent() {
      return state.parent;
    },
    get siblings() {
      return state.siblings;
    },
    importantRects: assembled.importantRects,
    restoreHost() {
      if (state.target.parentElement !== originalParent) {
        originalParent.insertBefore(state.target, originalNext);
      }
      world.stripEditorState(state.target);
      for (const sibling of state.siblings) {
        world.stripEditorState(sibling);
      }
    },
    replaceTarget() {
      const clone = state.target.cloneNode(true);
      if (!(clone instanceof HTMLElement)) {
        throw new Error(`${name}: clone failed`);
      }
      const pageRect = world.pageRectOf(state.target);
      const flow = world.flowOf(state.target);
      state.target.replaceWith(clone);
      if (pageRect) {
        world.bind(clone, pageRect, flow);
      }
      state.target = clone;
      return clone;
    },
  };
  return fixture;
}

/** Nested flex row of cards inside a flex column section. */
export function nestedFlexFixture(): VisualFixture {
  return createFixture(
    "nested-flex",
    `<main class="page">
      <section class="hero-row" style="display:flex">
        <article class="tile" data-fixture-id="flex-a"><h3>Alpha</h3><p>One</p></article>
        <article class="tile" data-fixture-id="flex-b"><h3>Beta</h3><p>Two</p></article>
        <article class="tile" data-fixture-id="flex-c"><h3>Gamma</h3><p>Three</p></article>
      </section>
    </main>`,
    (document, world) => {
      const parent = requireElement(document, ".hero-row");
      const tiles = Array.from(document.querySelectorAll(".tile")).filter(
        (node): node is HTMLElement => node instanceof HTMLElement,
      );
      world.bind(parent, { x: 24, y: 40, width: 720, height: 180 });
      bindFlowRow(world, tiles, { x: 40, y: 56, width: 200, height: 140 }, 16, "flex-tiles");
      const target = tiles[1];
      if (!target) {
        throw new Error("nested-flex missing target");
      }
      return {
        target,
        parent,
        siblings: tiles.filter((tile) => tile !== target),
        importantRects: () => ({
          target: world.measure(target),
          parent: world.measure(parent),
          siblingA: world.measure(tiles[0] as HTMLElement),
          siblingC: world.measure(tiles[2] as HTMLElement),
        }),
      };
    },
  );
}

/** Nested CSS grid of cards. */
export function nestedGridFixture(): VisualFixture {
  return createFixture(
    "nested-grid",
    `<main>
      <section class="gallery" style="display:grid">
        <article class="cell" data-fixture-id="grid-0"><span>North</span></article>
        <article class="cell" data-fixture-id="grid-1"><span>East</span></article>
        <article class="cell" data-fixture-id="grid-2"><span>South</span></article>
        <article class="cell" data-fixture-id="grid-3"><span>West</span></article>
      </section>
    </main>`,
    (document, world) => {
      const parent = requireElement(document, ".gallery");
      const cells = Array.from(document.querySelectorAll(".cell")).filter(
        (node): node is HTMLElement => node instanceof HTMLElement,
      );
      world.bind(parent, { x: 16, y: 16, width: 520, height: 360 });
      const positions: GeometryRect[] = [
        { x: 24, y: 24, width: 240, height: 160 },
        { x: 280, y: 24, width: 240, height: 160 },
        { x: 24, y: 200, width: 240, height: 160 },
        { x: 280, y: 200, width: 240, height: 160 },
      ];
      cells.forEach((cell, index) => {
        const rect = positions[index];
        if (rect) {
          world.bind(cell, rect, { group: "grid-row-0", index, axis: "none", gap: 16 });
        }
      });
      const target = cells[2];
      if (!target) {
        throw new Error("nested-grid missing target");
      }
      return {
        target,
        parent,
        siblings: cells.filter((cell) => cell !== target),
        importantRects: () => ({
          target: world.measure(target),
          parent: world.measure(parent),
          cell0: world.measure(cells[0] as HTMLElement),
          cell1: world.measure(cells[1] as HTMLElement),
        }),
      };
    },
  );
}

/** Block-level interactive card (`<a>` wrapping a heading and copy). */
export function interactiveCardFixture(): VisualFixture {
  return createFixture(
    "interactive-card",
    `<main>
      <a class="promo-card" href="/submit" data-fixture-id="promo">
        <h2>Submit a project</h2>
        <p>Open the form</p>
      </a>
    </main>`,
    (document, world) => {
      const target = requireElement(document, ".promo-card");
      const parent = requireElement(document, "main");
      world.bind(parent, { x: 0, y: 0, width: 800, height: 600 });
      world.bind(target, { x: 48, y: 96, width: 320, height: 120 });
      return {
        target,
        parent,
        siblings: [],
        importantRects: () => ({
          target: world.measure(target),
          parent: world.measure(parent),
        }),
      };
    },
  );
}

/** Repeated sibling cards with nearly identical classes and text. */
export function repeatedSiblingCardsFixture(targetIndex = 1): VisualFixture {
  return createFixture(
    "repeated-sibling-cards",
    `<main>
      <section class="feed">
        <article class="card item"><h2>Project</h2><p>Description</p></article>
        <article class="card item"><h2>Project</h2><p>Description</p></article>
        <article class="card item"><h2>Project</h2><p>Description</p></article>
      </section>
    </main>`,
    (document, world) => {
      const parent = requireElement(document, ".feed");
      const cards = Array.from(document.querySelectorAll(".card.item")).filter(
        (node): node is HTMLElement => node instanceof HTMLElement,
      );
      cards.forEach((card, index) => {
        card.setAttribute("data-fixture-id", `card-${String(index)}`);
      });
      world.bind(parent, { x: 32, y: 48, width: 360, height: 560 });
      bindFlowColumn(world, cards, { x: 48, y: 64, width: 320, height: 140 }, 16, "feed-cards");
      const target = cards[targetIndex];
      if (!target) {
        throw new Error("repeated-sibling-cards missing target");
      }
      return {
        target,
        parent,
        siblings: cards.filter((card) => card !== target),
        importantRects: () => ({
          target: world.measure(target),
          parent: world.measure(parent),
          card0: world.measure(cards[0] as HTMLElement),
          card2: world.measure(cards[2] as HTMLElement),
        }),
      };
    },
  );
}

/** A section containing many children, moved as a container. */
export function sectionContainerFixture(): VisualFixture {
  return createFixture(
    "section-container",
    `<main>
      <section class="stack">
        <h1>Overview</h1>
        <p>Intro copy</p>
        <ul><li>One</li><li>Two</li><li>Three</li></ul>
        <footer>Notes</footer>
      </section>
      <aside class="rail">Stay put</aside>
    </main>`,
    (document, world) => {
      const target = requireElement(document, ".stack");
      const parent = requireElement(document, "main");
      const rail = requireElement(document, ".rail");
      world.bind(parent, { x: 0, y: 0, width: 900, height: 700 });
      world.bind(target, { x: 24, y: 24, width: 520, height: 360 });
      world.bind(rail, { x: 560, y: 24, width: 280, height: 360 }, {
        group: "main-row",
        index: 1,
        axis: "x",
        gap: 16,
      });
      return {
        target,
        parent,
        siblings: [rail],
        importantRects: () => ({
          target: world.measure(target),
          parent: world.measure(parent),
          rail: world.measure(rail),
        }),
      };
    },
  );
}

/** Relatively positioned parent with an in-flow child. */
export function relativeParentFixture(): VisualFixture {
  return createFixture(
    "relative-parent",
    `<main>
      <div class="stage" style="position:relative">
        <div class="chip" data-fixture-id="chip">Label</div>
      </div>
    </main>`,
    (document, world) => {
      const parent = requireElement(document, ".stage");
      const target = requireElement(document, ".chip");
      world.bind(parent, { x: 80, y: 60, width: 400, height: 240 });
      world.bind(target, { x: 100, y: 84, width: 120, height: 32 });
      return {
        target,
        parent,
        siblings: [],
        importantRects: () => ({
          target: world.measure(target),
          parent: world.measure(parent),
        }),
      };
    },
  );
}

/** Absolutely positioned descendant inside a relative containing block. */
export function absoluteDescendantFixture(): VisualFixture {
  return createFixture(
    "absolute-descendant",
    `<main>
      <div class="frame" style="position:relative">
        <div class="badge" style="position:absolute" data-fixture-id="badge">New</div>
      </div>
    </main>`,
    (document, world) => {
      const parent = requireElement(document, ".frame");
      const target = requireElement(document, ".badge");
      world.bind(parent, { x: 40, y: 80, width: 360, height: 200 });
      world.bind(target, { x: 280, y: 96, width: 72, height: 24 });
      return {
        target,
        parent,
        siblings: [],
        importantRects: () => ({
          target: world.measure(target),
          parent: world.measure(parent),
        }),
      };
    },
  );
}

/** Sticky descendant currently supported as a live visual target. */
export function stickyDescendantFixture(): VisualFixture {
  return createFixture(
    "sticky-descendant",
    `<main>
      <section class="article">
        <aside class="toc" style="position:sticky" data-fixture-id="toc">Contents</aside>
        <div class="body">Long copy</div>
      </section>
    </main>`,
    (document, world) => {
      const parent = requireElement(document, ".article");
      const target = requireElement(document, ".toc");
      const body = requireElement(document, ".body");
      world.bind(parent, { x: 16, y: 16, width: 640, height: 800 });
      world.bind(target, { x: 32, y: 32, width: 160, height: 200 });
      world.bind(body, { x: 208, y: 32, width: 420, height: 720 });
      return {
        target,
        parent,
        siblings: [body],
        importantRects: () => ({
          target: world.measure(target),
          parent: world.measure(parent),
          body: world.measure(body),
        }),
      };
    },
  );
}

/** Host framework replaces the selected node with a structurally equivalent clone. */
export function frameworkRerenderFixture(): VisualFixture {
  return createFixture(
    "framework-rerender",
    `<main>
      <div class="app-root">
        <article class="panel" data-fixture-id="panel"><h2>Settings</h2><p>Account</p></article>
      </div>
    </main>`,
    (document, world) => {
      const parent = requireElement(document, ".app-root");
      const target = requireElement(document, ".panel");
      world.bind(parent, { x: 20, y: 20, width: 480, height: 320 });
      world.bind(target, { x: 36, y: 40, width: 440, height: 280 });
      return {
        target,
        parent,
        siblings: [],
        importantRects: () => ({
          target: world.measure(target),
          parent: world.measure(parent),
        }),
      };
    },
  );
}

/**
 * Structurally similar elements where a class/tag-only signature is ambiguous.
 * The second card is the intended target.
 */
export function ambiguousSignatureFixture(): VisualFixture {
  return createFixture(
    "ambiguous-signature",
    `<main>
      <ul class="results">
        <li class="result row"><a class="title" href="/a">Same title</a></li>
        <li class="result row"><a class="title" href="/b">Same title</a></li>
        <li class="result row"><a class="title" href="/c">Same title</a></li>
      </ul>
    </main>`,
    (document, world) => {
      const parent = requireElement(document, ".results");
      const rows = Array.from(document.querySelectorAll(".result.row")).filter(
        (node): node is HTMLElement => node instanceof HTMLElement,
      );
      rows.forEach((row, index) => {
        row.setAttribute("data-fixture-id", `row-${String(index)}`);
      });
      world.bind(parent, { x: 12, y: 12, width: 400, height: 240 });
      bindFlowColumn(world, rows, { x: 20, y: 20, width: 380, height: 56 }, 8, "result-rows");
      const target = rows[1];
      if (!target) {
        throw new Error("ambiguous-signature missing target");
      }
      return {
        target,
        parent,
        siblings: rows.filter((row) => row !== target),
        importantRects: () => ({
          target: world.measure(target),
          parent: world.measure(parent),
          row0: world.measure(rows[0] as HTMLElement),
          row2: world.measure(rows[2] as HTMLElement),
        }),
      };
    },
  );
}

export function allVisualFixtures(): VisualFixture[] {
  return [
    nestedFlexFixture(),
    nestedGridFixture(),
    interactiveCardFixture(),
    repeatedSiblingCardsFixture(),
    sectionContainerFixture(),
    relativeParentFixture(),
    absoluteDescendantFixture(),
    stickyDescendantFixture(),
    frameworkRerenderFixture(),
    ambiguousSignatureFixture(),
  ];
}
