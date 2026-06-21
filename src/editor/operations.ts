import type { EditorTarget } from "./editor-target.js";
import type { ElementSignature } from "./element-signature.js";
import type { GroupId, OperationId, PageKey, VisualNodeId } from "./ids.js";

export type OperationSource = "manual" | "agent" | "import";
export type OperationStatus = "draft" | "preview" | "approved";

export type StyleProperty =
  | "color"
  | "backgroundColor"
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

export interface OperationBase<TType extends string, TPayload> {
  id: OperationId;
  type: TType;
  pageKey: PageKey;
  target: EditorTarget;
  payload: TPayload;
  createdAt: number;
  source: OperationSource;
  status: OperationStatus;
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
  | InsertImageOperation;

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
] as const;

export type EditorOperationType = (typeof OPERATION_TYPES)[number];

export function isEditorOperationType(value: string): value is EditorOperationType {
  return (OPERATION_TYPES as readonly string[]).includes(value);
}
