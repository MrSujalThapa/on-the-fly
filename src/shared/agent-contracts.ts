import type { EditorSelection } from "../editor/editor-selection.js";
import type { ElementSignature } from "../editor/element-signature.js";
import type { PageKey } from "../editor/ids.js";
import type { EditorOperation } from "../editor/operations.js";
import type { ValidationErrorCode } from "../editor/validation/validation-codes.js";

export type AgentVisualNodeKind =
  | "text"
  | "image"
  | "button"
  | "input"
  | "container"
  | "group"
  | "unknown";

export interface AgentVisualNode {
  id: string;
  kind: AgentVisualNodeKind;
  signature: ElementSignature;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  computed: {
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
  };
  parentId?: string;
  childIds: string[];
  isLikelyContainer?: boolean;
  isPageLevel?: boolean;
}

export interface AgentEditRequest {
  pageKey: PageKey;
  instruction: string;
  selection: EditorSelection;
  selectedNodes: AgentVisualNode[];
  nearbyNodes: AgentVisualNode[];
  existingOperations: EditorOperation[];
  screenshotCropDataUrl?: string;
}

export interface AgentEditResponse {
  draftOperations: EditorOperation[];
  summary: string[];
  warnings: string[];
  confidence: "low" | "medium" | "high";
}

export interface AgentPreviewState {
  operations: EditorOperation[];
  summary: string[];
  warnings: string[];
  status: "idle" | "validating" | "preview" | "rejected" | "approved";
}

export type AgentOperationValidationResult =
  | {
      ok: true;
      operations: EditorOperation[];
    }
  | {
      ok: false;
      errors: string[];
      codes: ValidationErrorCode[];
    };
