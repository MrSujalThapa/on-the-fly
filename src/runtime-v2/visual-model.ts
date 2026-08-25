import type { ElementSignature } from "../editor/element-signature.js";
import type { VisualNodeId } from "../editor/ids.js";
import type { IntendedRect } from "./placement-engine.js";

export type VisualRole = "content" | "unit" | "collection" | "section" | "root";

export interface VisualCapabilities {
  readonly movable: boolean;
}

export interface DurableVisualIdentity {
  readonly signature: ElementSignature;
}

export interface VisualNode {
  readonly id: VisualNodeId;
  readonly durableIdentity: DurableVisualIdentity;
  readonly role: VisualRole;
  readonly parentId: VisualNodeId | null;
  readonly childIds: readonly VisualNodeId[];
  readonly capabilities: VisualCapabilities;
}

export interface IdentityEvidence {
  readonly strategy:
    | "live-cache"
    | "stable-key"
    | "distinctive-content"
    | "stable-path"
    | "unresolved"
    | "ambiguous";
  readonly candidateCount: number;
  readonly cssPathMatched: boolean;
  readonly structureShifted: boolean;
  readonly matchedKeys: readonly string[];
  readonly reason?: string;
}

export interface ResolvedVisual {
  readonly kind: "resolved";
  readonly nodeId: VisualNodeId | null;
  readonly element: HTMLElement;
  readonly identity: DurableVisualIdentity;
  readonly evidence: IdentityEvidence;
}

export interface UnresolvedVisual {
  readonly kind: "unresolved";
  readonly nodeId: VisualNodeId | null;
  readonly identity: DurableVisualIdentity;
  readonly evidence: IdentityEvidence;
}

export interface AmbiguousVisual {
  readonly kind: "ambiguous";
  readonly nodeId: VisualNodeId | null;
  readonly identity: DurableVisualIdentity;
  readonly candidateCount: number;
  readonly evidence: IdentityEvidence;
}

export type VisualResolveResult = ResolvedVisual | UnresolvedVisual | AmbiguousVisual;

export function isResolvedVisual(value: VisualResolveResult): value is ResolvedVisual {
  return value.kind === "resolved";
}

export function isUnresolvedVisual(value: VisualResolveResult): value is UnresolvedVisual {
  return value.kind === "unresolved";
}

export function isAmbiguousVisual(value: VisualResolveResult): value is AmbiguousVisual {
  return value.kind === "ambiguous";
}

export interface VisualModel {
  pick(clientX: number, clientY: number): VisualNodeId | null;
  adopt(element: HTMLElement): VisualNodeId | null;
  knownIds(): readonly VisualNodeId[];
  get(id: VisualNodeId): VisualNode | null;
  parentOf(id: VisualNodeId): VisualNodeId | null;
  childrenOf(id: VisualNodeId): readonly VisualNodeId[];
  bind(id: VisualNodeId): HTMLElement | null;
  measure(ids: readonly VisualNodeId[]): ReadonlyMap<VisualNodeId, IntendedRect>;
  durableIdentityOf(id: VisualNodeId): DurableVisualIdentity | null;
  resolveNode(id: VisualNodeId): VisualResolveResult;
  resolveIdentity(identity: DurableVisualIdentity): VisualResolveResult;
  cache(id: VisualNodeId, element: HTMLElement): void;
  invalidate(id: VisualNodeId): void;
}
