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

export interface AmbiguousTarget {
  readonly kind: "ambiguous";
  readonly handle: ElementHandle;
  readonly candidateCount: number;
  readonly reason: string;
}

/** HTMLElement is a cache, never the source of truth. */
export interface ResolvedElement {
  readonly kind: "resolved";
  readonly handle: ElementHandle;
  readonly element: HTMLElement;
}

export type ResolveResult = ResolvedElement | UnresolvedTarget | AmbiguousTarget;

export function isUnresolvedTarget(value: ResolveResult): value is UnresolvedTarget {
  return value.kind === "unresolved";
}

export function isAmbiguousTarget(value: ResolveResult): value is AmbiguousTarget {
  return value.kind === "ambiguous";
}

export function isResolvedElement(value: ResolveResult): value is ResolvedElement {
  return value.kind === "resolved";
}

export interface ElementRegistry {
  register(element: HTMLElement): ElementHandle;
  resolve(handle: ElementHandle): ResolveResult;
  /** Cache a live node. Must not become ledger identity. */
  cache(handle: ElementHandle, element: HTMLElement): void;
  invalidate(handle: ElementHandle): void;
}
