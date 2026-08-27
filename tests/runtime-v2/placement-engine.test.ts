import { describe, expect, it } from "vitest";
import { createTestDocument } from "../editor/dom/test-document.js";
import { createPlacementEngine } from "../../src/runtime-v2/create-placement-engine.js";
import { layoutElement } from "../editor/measurement/layout-helpers.js";
import {
  applyPersistedDetachPlacement,
} from "../../src/editor/dom/managed-detach.js";

describe("PlacementEngine", () => {
  it("updates page coordinates when an already-detached target moves again", () => {
    const { document, root } = createTestDocument(`<div data-otf-detached="true">Child</div>`);
    const element = root.querySelector("div") as HTMLElement;
    document.body.appendChild(element);

    applyPersistedDetachPlacement(element, {
      id: "repeat-detach",
      type: "move",
      pageKey: "https://example.com/",
      target: {},
      payload: { dx: 12, dy: 8, detached: true, detachedLeft: 140, detachedTop: 90 },
      createdAt: 1,
      source: "manual",
      status: "draft",
    });

    expect(element.style.left).toBe("140px");
    expect(element.style.top).toBe("90px");
    expect(element.parentElement).toBe(document.body);
  });
  it("prefers in-flow transform for ordinary elements and keeps the flow slot", () => {
    const { root } = createTestDocument(`<article class="card">Card</article>`);
    const element = root.querySelector("article");
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const plan = createPlacementEngine().planMove({
      element,
      currentRect: { x: 40, y: 80, width: 120, height: 60 },
      dx: 24,
      dy: 12,
    });

    expect(plan.strategy).toBe("in-flow");
    expect(plan.flowSlotRemains).toBe(true);
    expect(plan.payload.detached).toBe(false);
    expect(plan.payload.interactionSafeFixed).toBe(false);
    expect(plan.payload.transformOnly).toBe(false);
    expect(plan.expectedRect).toEqual({ x: 64, y: 92, width: 120, height: 60 });
  });

  it("does not select interaction-safe-fixed merely because the target is a link", () => {
    const { root } = createTestDocument(`<a href="/x" class="card">Go</a>`);
    const element = root.querySelector("a");
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const plan = createPlacementEngine().planMove({
      element,
      currentRect: { x: 0, y: 0, width: 80, height: 20 },
      dx: 10,
      dy: 5,
    });

    expect(plan.strategy).toBe("in-flow");
    expect(plan.flowSlotRemains).toBe(true);
    expect(plan.payload.interactionSafeFixed).toBe(false);
  });

  it("makes an interactive child independently placeable when it leaves its parent", () => {
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
    expect(plan.flowSlotRemains).toBe(false);
    expect(plan.payload.detached).toBe(true);
    expect(plan.payload.detachedTop).toBe(130);
    expect(plan.payload.detachedWidth).toBe(80);
    expect(plan.payload.detachedHeight).toBe(30);
    expect(Number.parseInt(plan.payload.detachedZIndex ?? "0", 10)).toBeGreaterThan(100);
  });

  it("uses the same independent placement when a standalone link leaves its container", () => {
    const { root } = createTestDocument(`<section><a href="/settings">View settings</a></section>`);
    const parent = root.querySelector("section") as HTMLElement;
    const link = root.querySelector("a") as HTMLElement;
    layoutElement(parent, { x: 20, y: 20, width: 200, height: 100 });
    layoutElement(link, { x: 40, y: 40, width: 100, height: 20 });

    const plan = createPlacementEngine().planMove({
      element: link,
      currentRect: { x: 40, y: 40, width: 100, height: 20 },
      dx: 260,
      dy: 80,
    });

    expect(plan.strategy).toBe("detached");
    expect(plan.flowSlotRemains).toBe(false);
    expect(plan.payload.interactionSafeFixed).toBe(false);
    expect(plan.payload.detached).toBe(true);
    expect(plan.payload.detachedLeft).toBe(300);
    expect(plan.payload.detachedTop).toBe(120);
  });

  it("migrates a legacy logical detach to body-managed placement on its next move", () => {
    const { root } = createTestDocument(
      `<div role="radiogroup"><button role="radio" data-otf-detached="true">My posts</button></div>`,
    );
    const child = root.querySelector("button") as HTMLElement;
    const plan = createPlacementEngine().planMove({
      element: child,
      currentRect: { x: 40, y: 140, width: 90, height: 32 },
      dx: 30,
      dy: 20,
    });

    expect(plan.strategy).toBe("detached");
    expect(plan.flowSlotRemains).toBe(false);
    expect(plan.payload).toMatchObject({
      detached: true,
      transformOnly: false,
      interactionSafeFixed: false,
    });
    expect(plan.payload.detachedLeft).toBe(70);
    expect(plan.payload.detachedTop).toBe(160);
  });

  it("composes already-detached placement in page coordinates", () => {
    const { root } = createTestDocument(`<article class="card" data-otf-detached="true">Card</article>`);
    const element = root.querySelector("article");
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const plan = createPlacementEngine().planMove({
      element,
      currentRect: { x: 10, y: 20, width: 100, height: 40 },
      dx: 5,
      dy: 7,
    });

    expect(plan.strategy).toBe("detached");
    expect(plan.flowSlotRemains).toBe(false);
    expect(plan.coordinateSpace).toBe("page");
    expect(plan.payload.detached).toBe(true);
    expect(plan.payload.detachedLeft).toBe(15);
    expect(plan.payload.detachedTop).toBe(27);
  });

  it("plans an independent detached placement when a safe child leaves its parent", () => {
    const { root } = createTestDocument(
      `<section id="parent"><div id="child">Child</div></section>`,
    );
    const parent = root.querySelector("#parent") as HTMLElement;
    const child = root.querySelector("#child") as HTMLElement;
    layoutElement(parent, { x: 20, y: 20, width: 200, height: 120 });
    layoutElement(child, { x: 40, y: 40, width: 80, height: 30 });

    const plan = createPlacementEngine().planMove({
      element: child,
      currentRect: { x: 40, y: 40, width: 80, height: 30 },
      dx: 220,
      dy: 0,
    });

    expect(plan.strategy).toBe("detached");
    expect(plan.flowSlotRemains).toBe(false);
    expect(plan.payload.detached).toBe(true);
    expect(plan.payload.detachedLeft).toBe(260);
    expect(plan.payload.detachedTop).toBe(40);
  });

  it("migrates legacy interaction-safe-fixed placement to independent page coordinates", () => {
    const { root } = createTestDocument(
      `<button type="button" data-otf-interaction-fixed="true">Ok</button>`,
    );
    const element = root.querySelector("button");
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const plan = createPlacementEngine().planMove({
      element,
      currentRect: { x: 8, y: 16, width: 40, height: 24 },
      dx: 3,
      dy: 4,
    });

    expect(plan.strategy).toBe("detached");
    expect(plan.payload.interactionSafeFixed).toBe(false);
    expect(plan.payload.detachedLeft).toBe(11);
    expect(plan.payload.detachedTop).toBe(20);
  });
});
