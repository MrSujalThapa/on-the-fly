import type { EditorTarget } from "./editor-target.js";
import type { ElementSignature } from "./element-signature.js";
import type { HelperObjectRole } from "./helper-object-contract.js";
import type { GroupId, OperationId, PageKey, VisualNodeId } from "./ids.js";

export type OperationSource = "manual" | "agent" | "import";
export type OperationStatus = "draft" | "preview" | "approved";

export interface OperationAffectedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OperationMetadata {
  targetSummary?: string;
  /** Final visual rect used for save-window classification and deterministic replay. */
  affectedRect?: OperationAffectedRect;
  originalRect?: OperationAffectedRect;
  finalRect?: OperationAffectedRect;
  sourceCommand?: string;
}

export type StyleProperty =
  | "color"
  | "backgroundColor"
  | "backgroundImage"
  | "borderColor"
  | "borderWidth"
  | "borderRadius"
  | "fontSize"
  | "fontWeight"
  | "textAlign"
  | "opacity"
  | "boxShadow"
  | "filter";

export type ResizeMode = "box" | "font-aware" | "image";

export type { HelperObjectRole };

export interface HelperObjectRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type HelperObjectFill =
  | {
      type: "solid";
      color: string;
    }
  | {
      type: "linearGradient";
      angleDeg: number;
      stops: Array<{
        color: string;
        position: number;
      }>;
    };

export interface HelperObjectBorder {
  width: number;
  color: string;
  style: "solid" | "dashed" | "dotted";
}

export interface HelperObjectBoxShadow {
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  spreadRadius?: number;
  color: string;
}

export interface OperationBase<TType extends string, TPayload> {
  id: OperationId;
  type: TType;
  pageKey: PageKey;
  target: EditorTarget;
  payload: TPayload;
  createdAt: number;
  source: OperationSource;
  status: OperationStatus;
  metadata?: OperationMetadata;
}

export type StyleOperation = OperationBase<
  "style",
  {
    property: StyleProperty;
    value: string;
    previousValue?: string;
  }
>;

export type TextOperation = OperationBase<
  "text",
  {
    value: string;
    previousValue?: string;
    preserveFormat: true;
  }
>;

export type MoveOperation = OperationBase<
  "move",
  {
    dx: number;
    dy: number;
    previousDx?: number;
    previousDy?: number;
    /** Set when the element was promoted to the managed body layer after moving outside its parent. */
    detached?: boolean;
    detachedLeft?: number;
    detachedTop?: number;
    detachedZIndex?: string;
  }
>;

export type ResizeOperation = OperationBase<
  "resize",
  {
    width: number;
    height: number;
    previousWidth?: number;
    previousHeight?: number;
    mode: ResizeMode;
  }
>;

export type RotateOperation = OperationBase<
  "rotate",
  {
    degrees: number;
    previousDegrees?: number;
  }
>;

export type CropOperation = OperationBase<
  "crop",
  {
    top: number;
    right: number;
    bottom: number;
    left: number;
  }
>;

export type HideOperation = OperationBase<
  "hide",
  {
    hidden: boolean;
    previousDisplay?: string;
  }
>;

export type ZIndexOperation = OperationBase<
  "zIndex",
  {
    layer: number;
    previousLayer?: number;
  }
>;

export type GroupOperation = OperationBase<
  "group",
  {
    groupId: GroupId;
    memberNodeIds: VisualNodeId[];
    memberSignatures: ElementSignature[];
  }
>;

export type UngroupOperation = OperationBase<
  "ungroup",
  {
    groupId: GroupId;
  }
>;

export type InsertImageOperation = OperationBase<
  "insertImage",
  {
    assetId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    alt?: string;
  }
>;

export type InsertHelperObjectOperation = OperationBase<
  "insertHelperObject",
  {
    helperId: string;
    role: HelperObjectRole;
    rect: HelperObjectRect;
    fill?: HelperObjectFill;
    borderRadius?: string;
    opacity?: number;
    boxShadow?: HelperObjectBoxShadow;
    zIndex?: number;
    border?: HelperObjectBorder;
    label?: string;
  }
>;

export type DuplicateOperation = OperationBase<
  "duplicate",
  {
    cloneId: string;
    html: string;
    parentCssPath: string;
    offsetDx: number;
    offsetDy: number;
    sourceCssPath?: string;
    anchorLeft: number;
    anchorTop: number;
    anchorWidth: number;
    anchorHeight: number;
    styleSnapshot: Record<string, string>;
  }
>;

export type EditorOperation =
  | StyleOperation
  | TextOperation
  | MoveOperation
  | ResizeOperation
  | RotateOperation
  | CropOperation
  | HideOperation
  | ZIndexOperation
  | GroupOperation
  | UngroupOperation
  | InsertImageOperation
  | InsertHelperObjectOperation
  | DuplicateOperation;

export const OPERATION_TYPES = [
  "style",
  "text",
  "move",
  "resize",
  "rotate",
  "crop",
  "hide",
  "zIndex",
  "group",
  "ungroup",
  "insertImage",
  "insertHelperObject",
  "duplicate",
] as const;

export type EditorOperationType = (typeof OPERATION_TYPES)[number];

export function isEditorOperationType(value: string): value is EditorOperationType {
  return (OPERATION_TYPES as readonly string[]).includes(value);
}
