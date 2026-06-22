import { describe, expect, it } from "vitest";
import { createGeometryCacheBundle } from "../../../src/editor/visual-graph/dom-invalidation-listener.js";
import { createTestDocument } from "../dom/test-document.js";
import { layoutTree } from "../measurement/layout-helpers.js";

describe("GeometryCache", () => {
  it("rebuilds lazily and bumps version on refresh", () => {
    const { document } = createTestDocument(
      `<main><p class="intro">Hello</p><button>Go</button></main>`,
    );
    layoutTree(document.body);

    const cache = createGeometryCacheBundle({ root: document }).cache;
    expect(cache.getGraph()).toBeNull();
    expect(cache.isDirty()).toBe(true);

    const first = cache.ensureFresh();
    expect(first.getNodeCount()).toBeGreaterThan(0);
    expect(cache.isDirty()).toBe(false);
    expect(cache.getVersion()).toBe(1);

    cache.invalidate("edit");
    expect(cache.isDirty()).toBe(true);

    const second = cache.ensureFresh();
    expect(second.getVersion()).toBe(2);
    expect(cache.getState().lastInvalidationReason).toBe("edit");
  });

  it("returns cached graph until invalidated", () => {
    const { document } = createTestDocument(`<main><p>Hello</p></main>`);
    layoutTree(document.body);

    const cache = createGeometryCacheBundle({ root: document }).cache;
    const first = cache.ensureFresh();
    const second = cache.ensureFresh();

    expect(first).toBe(second);
    expect(cache.getVersion()).toBe(1);
  });

  it("marks cache dirty when scheduler flushes", () => {
    const { document } = createTestDocument(`<main><p>Hello</p></main>`);
    layoutTree(document.body);

    const { cache, scheduler } = createGeometryCacheBundle({ root: document });
    cache.ensureFresh();
    expect(cache.isDirty()).toBe(false);

    scheduler.flush();
    expect(cache.isDirty()).toBe(false);

    scheduler.request("manual");
    expect(cache.isDirty()).toBe(true);
  });
});
