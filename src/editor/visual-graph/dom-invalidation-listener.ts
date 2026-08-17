import type { GeometryCache } from "./geometry-cache.js";
import { createGeometryCache } from "./geometry-cache.js";
import {
  InvalidationScheduler,
  createInvalidationScheduler,
  resolvePrimaryInvalidationReason,
} from "./invalidation-scheduler.js";
import type {
  DomInvalidationListenerOptions,
  GeometryCacheOptions,
  InvalidationSchedulerOptions,
} from "./types.js";

function getMutationObserverRoot(root: ParentNode, override?: Node): Node {
  if (override) {
    return override;
  }

  if ("body" in root && root.body instanceof Element) {
    return root.body;
  }

  if (root instanceof Element) {
    return root;
  }

  throw new Error("attachDomInvalidationListeners requires a Document or Element root");
}

export interface GeometryCacheBundle {
  cache: GeometryCache;
  scheduler: InvalidationScheduler;
}

export function createGeometryCacheBundle(
  cacheOptions: GeometryCacheOptions,
  schedulerOptions: Omit<InvalidationSchedulerOptions, "onFlush"> = {},
  onInvalidated?: (reasons: import("./types.js").InvalidationReason[]) => void,
): GeometryCacheBundle {
  const cache = createGeometryCache(cacheOptions);
  const scheduler = createInvalidationScheduler({
    ...schedulerOptions,
    onFlush: (reasons) => {
      cache.invalidate(resolvePrimaryInvalidationReason(reasons));
      onInvalidated?.(reasons);
    },
  });

  return { cache, scheduler };
}

export function attachDomInvalidationListeners(
  options: DomInvalidationListenerOptions,
): () => void {
  const onScroll = (): void => {
    options.scheduler.request("scroll");
  };
  const onResize = (): void => {
    options.scheduler.request("resize");
  };

  options.window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  options.window.addEventListener("resize", onResize);

  const observer = new MutationObserver(() => {
    options.scheduler.request("mutation");
  });

  observer.observe(getMutationObserverRoot(options.root, options.mutationRoot), {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });

  return () => {
    options.window.removeEventListener("scroll", onScroll, true);
    options.window.removeEventListener("resize", onResize);
    observer.disconnect();
  };
}

export interface GeometryCacheController {
  cache: GeometryCache;
  scheduler: InvalidationScheduler;
  dispose: () => void;
}

export function createGeometryCacheController(options: {
  cacheOptions: GeometryCacheOptions;
  schedulerOptions?: Omit<InvalidationSchedulerOptions, "onFlush">;
  listeners?: Omit<DomInvalidationListenerOptions, "scheduler">;
  onInvalidated?: (reasons: import("./types.js").InvalidationReason[]) => void;
}): GeometryCacheController {
  const { cache, scheduler } = createGeometryCacheBundle(
    options.cacheOptions,
    options.schedulerOptions ?? {},
    options.onInvalidated,
  );

  const disposers: Array<() => void> = [];

  if (options.listeners) {
    disposers.push(
      attachDomInvalidationListeners({
        ...options.listeners,
        scheduler,
      }),
    );
  }

  return {
    cache,
    scheduler,
    dispose: () => {
      for (const dispose of disposers) {
        dispose();
      }
      scheduler.dispose();
    },
  };
}
