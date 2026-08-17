import { describe, expect, it } from "vitest";
import { createTestDocument } from "../editor/dom/test-document.js";
import { createPlacementEngine } from "../../src/runtime-v2/create-placement-engine.js";

describe("PlacementEngine", () => {
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
    expect(plan.payload.transformOnly).toBe(true);
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

  it("composes already-managed interaction-safe-fixed in viewport coordinates", () => {
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

    expect(plan.strategy).toBe("interaction-safe-fixed");
    expect(plan.payload.interactionSafeFixed).toBe(true);
    expect(plan.payload.fixedViewportLeft).toBe(11);
    expect(plan.payload.fixedViewportTop).toBe(20);
  });
});
