import type { ElementSignature } from "../element-signature.js";
import type { VisualNodeId } from "../ids.js";
import type { EditorTarget } from "../editor-target.js";
import type { VisualNode, VisualNodeRect } from "../visual-node.js";

/**
 * A transform target is the minimal data the transform controller needs to
 * generate an operation and re-measure an element: a stable signature (so the
 * DOM runtime adapter can resolve the live element) plus the last known rect.
 */
export interface TransformTarget {
  nodeId: VisualNodeId;
  signature: ElementSignature;
  rect: VisualNodeRect;
  /**
   * Runtime-only live element reference (DOM-first selection). When present and
   * still connected, the transform controller applies operations directly to
   * this element instead of re-resolving by signature. Not serialized.
   */
  element?: HTMLElement;
}

export function toTransformTarget(node: VisualNode): TransformTarget {
  return {
    nodeId: node.id,
    signature: node.signature,
    rect: { ...node.rect },
    ...(node.element ? { element: node.element } : {}),
  };
}

export function toTransformTargets(nodes: VisualNode[]): TransformTarget[] {
  return nodes.map(toTransformTarget);
}

export function transformTargetToEditorTarget(target: TransformTarget): EditorTarget {
  return {
    nodeId: target.nodeId,
    signature: target.signature,
  };
}
