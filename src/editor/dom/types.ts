import type { OperationId } from "../ids.js";

export const OTF_MANAGED_ATTR = "data-otf-managed";
export const OTF_TRANSFORM_ATTR = "data-otf-transform";
export const OTF_CROP_ATTR = "data-otf-crop";
export const OTF_HELPER_ATTR = "data-otf-helper-id";
export const OTF_HELPER_ROLE_ATTR = "data-otf-helper-role";

export interface ElementStyleSnapshot {
  inlineStyle: string;
  /** Restorable presentation cssText used for deterministic undo/clear. */
  presentationCssText: string;
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
  | { kind: "size"; previousWidth: string; previousHeight: string; previousBoxSizing: string }
  | { kind: "zIndex"; previousValue: string }
  | { kind: "position"; previousValue: string }
  | {
      kind: "clip";
      previousClipPath: string;
      previousWebkitClipPath: string;
      previousCropAttr: string | null;
    }
  | {
      kind: "duplicate";
      previousHtml: string;
      previousParent: HTMLElement | null;
    };

import type { ElementDomSnapshot } from "./dom-placement-snapshot.js";

export interface AppliedDomEffect {
  operationId: OperationId;
  changes: DomChange[];
  beforeSnapshot: ElementDomSnapshot;
  afterSnapshot: ElementDomSnapshot;
}

import type { DomErrorCode } from "../validation/validation-codes.js";

export interface DomApplySuccess {
  ok: true;
}

export interface DomApplyFailure {
  ok: false;
  error: string;
  code: DomErrorCode;
  validationErrors?: string[];
}

export type DomApplyResult = DomApplySuccess | DomApplyFailure;

export function createDomApplySuccess(): DomApplySuccess {
  return { ok: true };
}

export function createDomApplyFailure(
  code: DomErrorCode,
  error: string,
  validationErrors?: string[],
): DomApplyFailure {
  const failure: DomApplyFailure = { ok: false, code, error };
  if (validationErrors && validationErrors.length > 0) {
    failure.validationErrors = validationErrors;
  }
  return failure;
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
