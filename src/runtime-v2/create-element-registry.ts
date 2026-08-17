import type { ElementSignature } from "../editor/element-signature.js";
import { isDangerousCssPath } from "../editor/validation/dangerous-selectors.js";
import {
  buildPersistableElementSignature,
  buildUniqueCssPath,
} from "../editor/measurement/signature-builder.js";
import {
  type AmbiguousTarget,
  type ElementHandle,
  type ElementRegistry,
  type ResolveResult,
  type UnresolvedTarget,
} from "./element-registry.js";

let handleCounter = 0;

function nextHandleId(): string {
  handleCounter += 1;
  return `otf-el-${handleCounter.toString(36)}`;
}

function queryCssPath(root: ParentNode, cssPath: string): HTMLElement[] {
  if (!cssPath || isDangerousCssPath(cssPath)) {
    return [];
  }
  const scope = root instanceof Document ? root.documentElement : root;
  try {
    return Array.from(scope.querySelectorAll(cssPath)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
  } catch {
    return [];
  }
}

function uniqueTo(
  root: ParentNode,
  cssPath: string,
  expected: HTMLElement,
): boolean {
  const matches = queryCssPath(root, cssPath);
  return matches.length === 1 && matches[0] === expected;
}

function strengthenSignature(element: HTMLElement, root: ParentNode): ElementSignature {
  const signature = buildPersistableElementSignature(element, { root });
  const uniquePath = buildUniqueCssPath(element, root);
  return {
    ...signature,
    cssPath: uniquePath,
  };
}

export function createElementRegistry(root: ParentNode): ElementRegistry {
  const cache = new Map<string, WeakRef<HTMLElement>>();

  const readCache = (handle: ElementHandle): HTMLElement | null => {
    const ref = cache.get(handle.id);
    if (!ref) {
      return null;
    }
    const element = ref.deref() ?? null;
    if (!element || !element.isConnected) {
      cache.delete(handle.id);
      return null;
    }
    return element;
  };

  const resolveFromSignature = (handle: ElementHandle): ResolveResult => {
    const matches = queryCssPath(root, handle.signature.cssPath);
    if (matches.length === 1) {
      const element = matches[0];
      if (!element) {
        return { kind: "unresolved", handle, reason: "cssPath_empty" } satisfies UnresolvedTarget;
      }
      cache.set(handle.id, new WeakRef(element));
      return { kind: "resolved", handle, element };
    }
    if (matches.length > 1) {
      return {
        kind: "ambiguous",
        handle,
        candidateCount: matches.length,
        reason: "cssPath_not_unique",
      } satisfies AmbiguousTarget;
    }
    return { kind: "unresolved", handle, reason: "cssPath_no_match" };
  };

  return {
    register(element: HTMLElement): ElementHandle {
      const signature = strengthenSignature(element, root);
      const handle: ElementHandle = {
        id: nextHandleId(),
        signature,
      };
      if (element.isConnected) {
        cache.set(handle.id, new WeakRef(element));
      }
      return handle;
    },

    resolve(handle: ElementHandle): ResolveResult {
      const cached = readCache(handle);
      if (cached) {
        if (uniqueTo(root, handle.signature.cssPath, cached) || cached.isConnected) {
          return { kind: "resolved", handle, element: cached };
        }
      }
      return resolveFromSignature(handle);
    },

    cache(handle: ElementHandle, element: HTMLElement): void {
      if (!element.isConnected) {
        cache.delete(handle.id);
        return;
      }
      cache.set(handle.id, new WeakRef(element));
    },

    invalidate(handle: ElementHandle): void {
      cache.delete(handle.id);
    },
  };
}
