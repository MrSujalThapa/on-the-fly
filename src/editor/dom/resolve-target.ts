import type { EditorTarget } from "../editor-target.js";
import {
  matchElementBySignatureDetailed,
  summarizeElementSignature,
  type SignatureMatchDiagnostics,
} from "./signature-matcher.js";

export interface TargetResolutionResult {
  element: HTMLElement | null;
  diagnostics: SignatureMatchDiagnostics & {
    signatureSummary: string;
  };
}

export function resolveTargetElementDetailed(
  root: ParentNode,
  target: EditorTarget,
): TargetResolutionResult {
  if (!target.signature) {
    return {
      element: null,
      diagnostics: {
        resolved: false,
        matchStrategy: "unresolved",
        failureReason: "missing_signature",
        signatureSummary: "no-signature",
      },
    };
  }

  const match = matchElementBySignatureDetailed(root, target.signature);
  return {
    element: match.element,
    diagnostics: {
      ...match.diagnostics,
      signatureSummary: summarizeElementSignature(target.signature),
    },
  };
}

export function resolveTargetElement(root: ParentNode, target: EditorTarget): HTMLElement | null {
  return resolveTargetElementDetailed(root, target).element;
}
