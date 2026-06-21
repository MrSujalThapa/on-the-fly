import type { EditorTarget } from "../editor-target.js";
import { matchElementBySignature } from "./signature-matcher.js";

export function resolveTargetElement(root: ParentNode, target: EditorTarget): HTMLElement | null {
  if (target.signature) {
    return matchElementBySignature(root, target.signature);
  }

  return null;
}
