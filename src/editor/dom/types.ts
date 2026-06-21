import type { OperationId } from "../ids.js";

export const OTF_MANAGED_ATTR = "data-otf-managed";
export const OTF_TRANSFORM_ATTR = "data-otf-transform";

export interface ElementStyleSnapshot {
  inlineStyle: string;
  display: string;
  visibility: string;
  transform: string;
  width: string;
  height: string;
  zIndex: string;
  position: string;
  textContent: string;
}

export type DomChange =
  | { kind: "style"; property: string; previousValue: string }
  | { kind: "text"; previousValue: string }
  | { kind: "display"; previousValue: string }
  | { kind: "visibility"; previousValue: string }
  | { kind: "transform-state"; previousState: string | null }
  | { kind: "size"; previousWidth: string; previousHeight: string }
  | { kind: "zIndex"; previousValue: string }
  | { kind: "position"; previousValue: string };

export interface AppliedDomEffect {
  operationId: OperationId;
  changes: DomChange[];
}

export interface DomApplyResult {
  ok: boolean;
  error?: string;
}

export interface StoredTransformState {
  dx: number;
  dy: number;
  width: number | null;
  height: number | null;
  rotate: number;
  position: string;
}

export interface MatchViewport {
  width: number;
  height: number;
}
