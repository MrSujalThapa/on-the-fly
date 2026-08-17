import type { EditorTarget } from "../editor-target.js";
import {
  getElementResolver,
  type ElementResolveResult,
} from "./element-resolver.js";

export type TargetResolutionResult = ElementResolveResult;

export function resolveTargetElementDetailed(
  root: ParentNode,
  target: EditorTarget,
): TargetResolutionResult {
  return getElementResolver(root).resolveTarget(target);
}

export function resolveTargetElement(root: ParentNode, target: EditorTarget): HTMLElement | null {
  return resolveTargetElementDetailed(root, target).element;
}
