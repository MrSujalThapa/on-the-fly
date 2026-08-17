import type { ElementSignature } from "../editor/element-signature.js";

/** Durable identity. Long-lived runtime state stores this, not HTMLElement. */
export interface ElementHandle {
  readonly id: string;
  readonly signature: ElementSignature;
}

export interface UnresolvedTarget {
  readonly kind: "unresolved";
  readonly handle: ElementHandle;
  readonly reason: string;
}

/** HTMLElement is a cache, never the source of truth. */
export interface ResolvedElement {
  readonly handle: ElementHandle;
  readonly element: HTMLElement;
}

export type ResolveResult = ResolvedElement | UnresolvedTarget;

export function isUnresolvedTarget(value: ResolveResult): value is UnresolvedTarget {
  return "kind" in value;
}

export interface ElementRegistry {
  register(element: HTMLElement): ElementHandle;
  resolve(handle: ElementHandle): ResolveResult;
  /** Cache a live node. Must not become ledger identity. */
  cache(handle: ElementHandle, element: HTMLElement): void;
  invalidate(handle: ElementHandle): void;
}
