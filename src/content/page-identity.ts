import type { PageKey } from "../editor/ids.js";

export type PageKeyListener = (next: PageKey, previous: PageKey) => void;

export interface PageIdentity {
  current(): PageKey;
  subscribe(listener: PageKeyListener): () => void;
  dispose(): void;
}

interface HistoryPatch {
  refCount: number;
  listeners: Set<() => void>;
  restore: () => void;
}

const historyPatches = new WeakMap<object, HistoryPatch>();

/**
 * Page identity is origin + pathname. Query and hash are ignored so existing
 * saved keys stay compatible with static multi-page sites.
 */
export function computeDocumentPageKey(root: Document): PageKey {
  const location = root.defaultView?.location;
  if (location) {
    return `${location.origin}${location.pathname}`;
  }
  return "otf://unknown";
}

export function createPageIdentity(root: Document): PageIdentity {
  let currentKey = computeDocumentPageKey(root);
  const listeners = new Set<PageKeyListener>();
  const view = root.defaultView;

  const emitIfChanged = (): void => {
    const next = computeDocumentPageKey(root);
    if (next === currentKey) {
      return;
    }
    const previous = currentKey;
    currentKey = next;
    for (const listener of listeners) {
      listener(next, previous);
    }
  };

  const unwatch = view ? watchHistory(view, emitIfChanged) : () => undefined;

  return {
    current: () => currentKey,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      listeners.clear();
      unwatch();
    },
  };
}

function watchHistory(view: Window, onNavigate: () => void): () => void {
  let patch = historyPatches.get(view);
  if (!patch) {
    const history = view.history;
    const originalPush = history.pushState.bind(history);
    const originalReplace = history.replaceState.bind(history);
    const navigationListeners = new Set<() => void>();
    const notify = (): void => {
      for (const listener of navigationListeners) {
        listener();
      }
    };

    history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
      originalPush(data, unused, url);
      notify();
    }) as typeof history.pushState;
    history.replaceState = ((data: unknown, unused: string, url?: string | URL | null) => {
      originalReplace(data, unused, url);
      notify();
    }) as typeof history.replaceState;
    view.addEventListener("popstate", notify);

    patch = {
      refCount: 0,
      listeners: navigationListeners,
      restore: () => {
        history.pushState = originalPush;
        history.replaceState = originalReplace;
        view.removeEventListener("popstate", notify);
      },
    };
    historyPatches.set(view, patch);
  }

  patch.refCount += 1;
  patch.listeners.add(onNavigate);

  return () => {
    const active = historyPatches.get(view);
    if (!active) {
      return;
    }
    active.listeners.delete(onNavigate);
    active.refCount -= 1;
    if (active.refCount <= 0) {
      active.restore();
      historyPatches.delete(view);
    }
  };
}
