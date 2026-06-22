import type { ElementSignature } from "./element-signature.js";
import type { VisualNodeId } from "./ids.js";

export type VisualNodeKind =
  | "text"
  | "image"
  | "button"
  | "input"
  | "container"
  | "group"
  | "unknown";

export interface VisualNodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualNodeComputedStyles {
  display?: string;
  position?: string;
  zIndex?: string;
  color?: string;
  backgroundColor?: string;
  borderRadius?: string;
  fontSize?: string;
  fontWeight?: string;
  textAlign?: string;
  opacity?: string;
  transform?: string;
  overflow?: string;
}

export interface VisualNode {
  id: VisualNodeId;
  kind: VisualNodeKind;
  signature: ElementSignature;
  rect: VisualNodeRect;
  computed: VisualNodeComputedStyles;
  parentId?: VisualNodeId;
  childIds: VisualNodeId[];
  isLikelyContainer?: boolean;
  isPageLevel?: boolean;
  /**
   * Runtime-only live reference to the backing DOM element. Set for DOM-first
   * (rectangle) selection targets so transforms hit the exact selected element
   * during the active session without depending on signature re-resolution.
   * Never serialized; persistence relies on {@link signature}.
   */
  element?: HTMLElement;
}
