import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachDomInvalidationListeners,
  createGeometryCacheBundle,
} from "../../../src/editor/visual-graph/dom-invalidation-listener.js";
import {
  InvalidationScheduler,
  resolvePrimaryInvalidationReason,
} from "../../../src/editor/visual-graph/invalidation-scheduler.js";
import type { InvalidationReason } from "../../../src/editor/visual-graph/types.js";
import { createTestDocument } from "../dom/test-document.js";
import { layoutTree } from "../measurement/layout-helpers.js";

describe("InvalidationScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles scroll and resize requests", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn<(reasons: InvalidationReason[]) => void>();
    const scheduler = new InvalidationScheduler({
      onFlush,
      throttleMs: 100,
      debounceMs: 150,
    });

    scheduler.request("scroll");
    scheduler.request("scroll");
    scheduler.request("resize");
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0]?.[0]).toEqual(["scroll", "resize"]);
  });

  it("debounces mutation and edit requests", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const scheduler = new InvalidationScheduler({
      onFlush,
      throttleMs: 100,
      debounceMs: 150,
    });

    scheduler.request("mutation");
    vi.advanceTimersByTime(50);
    scheduler.request("edit");
    vi.advanceTimersByTime(100);
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0]?.[0]).toEqual(["mutation", "edit"]);
  });

  it("flushes manual invalidation immediately", () => {
    vi.useFakeTimers();
    const onFlush = vi.fn();
    const scheduler = new InvalidationScheduler({ onFlush });

    scheduler.request("manual");
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("resolves the primary invalidation reason", () => {
    expect(resolvePrimaryInvalidationReason(["scroll", "mutation"])).toBe("mutation");
    expect(resolvePrimaryInvalidationReason(["scroll", "resize"])).toBe("resize");
    expect(resolvePrimaryInvalidationReason(["manual", "scroll"])).toBe("manual");
  });
});

describe("DOM invalidation listeners", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules scroll invalidation from DOM listeners", () => {
    vi.useFakeTimers();
    const { document } = createTestDocument(`<main><p>Hello</p></main>`);
    layoutTree(document.body);

    const onFlush = vi.fn();
    const scheduler = new InvalidationScheduler({
      onFlush,
      throttleMs: 100,
    });
    const dispose = attachDomInvalidationListeners({
      window: document.defaultView as Window,
      root: document,
      scheduler,
      mutationRoot: document.body,
    });

    document.defaultView?.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(100);
    expect(onFlush).toHaveBeenCalledWith(["scroll"]);

    dispose();
    scheduler.dispose();
  });

  it("connects scheduler flushes to geometry cache invalidation", () => {
    vi.useFakeTimers();
    const { document } = createTestDocument(`<main><p>Hello</p></main>`);
    layoutTree(document.body);

    const { cache, scheduler } = createGeometryCacheBundle(
      { root: document },
      { debounceMs: 50 },
    );
    cache.ensureFresh();

    scheduler.request("mutation");
    vi.advanceTimersByTime(50);
    expect(cache.isDirty()).toBe(true);
    expect(cache.getState().lastInvalidationReason).toBe("mutation");
  });
});
