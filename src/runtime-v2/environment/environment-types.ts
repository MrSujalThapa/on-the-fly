import type { CreatedElementAppearance, CreatedElementContent, CreatedElementKind } from "../../editor/create/created-element.js";
import type { VisualNodeId } from "../../editor/ids.js";
import type { StyleProperty } from "../../editor/operations.js";
import type { LayerCommand } from "../../editor/transform/layer-order.js";
import type { EnvironmentError } from "./environment-errors.js";

/** Session identity for a VisualModel node. Not a fourth identity system. */
export type ElementId = VisualNodeId;

export type ElementOrigin = "host" | "clone" | "created";

export interface ViewportSnapshot {
  readonly width: number;
  readonly height: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

export interface GeometrySnapshot {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly rotation: number;
  readonly placement: "attached" | "independent";
}

export interface ComputedStyleSnapshot {
  readonly display: string;
  readonly position: string;
  readonly visibility: string;
  readonly opacity: string;
  readonly width: string;
  readonly height: string;
  readonly color: string;
  readonly backgroundColor: string;
  readonly backgroundImage: string;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly textAlign: string;
  readonly borderWidth: string;
  readonly borderColor: string;
  readonly borderRadius: string;
  readonly boxShadow: string;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly zIndex: string;
  readonly flexDirection: string;
  readonly alignItems: string;
  readonly justifyContent: string;
  readonly gap: string;
  readonly gridTemplateColumns: string;
  readonly gridTemplateRows: string;
}

export interface ElementCapabilities {
  readonly move: boolean;
  readonly resize: boolean;
  readonly rotate: boolean;
  readonly style: boolean;
  readonly editText: boolean;
  readonly crop: boolean;
  readonly delete: boolean;
  readonly duplicate: boolean;
  readonly layer: boolean;
}

export interface ElementSummary {
  readonly id: ElementId;
  readonly origin: ElementOrigin;
  readonly tag?: string;
  readonly role?: string;
  readonly text?: string;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly selected: boolean;
}

export interface ElementObservation {
  readonly id: ElementId;
  readonly origin: ElementOrigin;
  readonly tag?: string;
  readonly role?: string;
  readonly visibleText?: string;
  readonly geometry: GeometrySnapshot;
  readonly computedStyle: ComputedStyleSnapshot;
  readonly capabilities: ElementCapabilities;
  readonly relationships: {
    readonly parent?: ElementId;
    readonly children: readonly ElementId[];
    readonly group?: string;
  };
}

export interface ObserveOptions {
  readonly scope?: "viewport" | "selection";
}

export interface PageObservation {
  readonly sessionId: string;
  readonly url: string;
  readonly viewport: ViewportSnapshot;
  readonly selection: readonly ElementId[];
  readonly elements: readonly ElementSummary[];
  readonly revision: number;
}

export interface ElementQuery {
  readonly text?: string;
  readonly role?: string;
  readonly tag?: string;
  readonly origin?: ElementOrigin;
  readonly within?: ElementId;
  readonly visibleOnly?: boolean;
}

export interface EnvironmentRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type OTFOperation =
  | { readonly type: "move"; readonly target: ElementId; readonly delta: { readonly x: number; readonly y: number } }
  | {
      readonly type: "resize";
      readonly targets: readonly ElementId[];
      readonly toBounds: EnvironmentRect;
      readonly fromBounds?: EnvironmentRect;
    }
  | {
      readonly type: "rotate";
      readonly targets: readonly ElementId[];
      readonly degrees: number;
    }
  | { readonly type: "layer"; readonly target: ElementId; readonly command: LayerCommand }
  | { readonly type: "style"; readonly target: ElementId; readonly property: StyleProperty; readonly value: string; readonly scope?: "self" | "text-subtree" }
  | { readonly type: "text"; readonly target: ElementId; readonly value: string }
  | { readonly type: "crop"; readonly target: ElementId; readonly insets: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number } }
  | {
      readonly type: "create";
      readonly kind: CreatedElementKind;
      readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
      readonly appearance?: CreatedElementAppearance;
      readonly content?: CreatedElementContent;
      readonly elementId?: string;
    }
  | { readonly type: "delete"; readonly target: ElementId }
  | { readonly type: "duplicate"; readonly target: ElementId }
  | { readonly type: "group"; readonly targets: readonly ElementId[] }
  | { readonly type: "ungroup" };

export type OTFChange =
  | { readonly type: "move"; readonly target: ElementId; readonly delta: { readonly x: number; readonly y: number } }
  | { readonly type: "resize"; readonly target: ElementId; readonly size: { readonly width: number; readonly height: number } }
  | { readonly type: "rotate"; readonly target: ElementId; readonly degrees: number }
  | { readonly type: "layer"; readonly target: ElementId; readonly layer: number }
  | { readonly type: "style"; readonly target: ElementId; readonly property: string; readonly value: string }
  | { readonly type: "text"; readonly target: ElementId; readonly value: string }
  | { readonly type: "crop"; readonly target: ElementId }
  | { readonly type: "create"; readonly target: ElementId; readonly kind: string }
  | { readonly type: "duplicate"; readonly target: ElementId }
  | { readonly type: "delete"; readonly target: ElementId }
  | { readonly type: "other"; readonly target: ElementId; readonly operationType: string };

export interface OperationResult {
  readonly ok: boolean;
  readonly operationId?: string;
  readonly target?: ElementId;
  readonly before?: GeometrySnapshot;
  readonly after?: GeometrySnapshot;
  readonly revision?: number;
  readonly error?: EnvironmentError;
}

/**
 * V1 batching is intentionally limited.
 *
 * `atomic: true` only for same-delta MOVE, homogeneous DELETE, or identical STYLE maps.
 * Mixed or other homogeneous batches run sequentially with `atomic: false` and **stop on the
 * first failure**. Remaining operations are not executed; `results` contains only attempts.
 */
export interface BatchResult {
  readonly ok: boolean;
  readonly atomic: boolean;
  readonly results: readonly OperationResult[];
  readonly error?: EnvironmentError;
}

export type CheckpointId = string;

export interface RollbackResult {
  readonly ok: boolean;
  readonly revision?: number;
  readonly error?: EnvironmentError;
}

export interface OTFSessionState {
  readonly sessionId: string;
  readonly url: string;
  readonly viewport: ViewportSnapshot;
  readonly selection: readonly ElementId[];
  readonly revision: number;
  readonly persistedRevision: number;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly elementCounts: { readonly host: number; readonly clone: number; readonly created: number };
}

export interface OTFEnvironment {
  observe(options?: ObserveOptions): Promise<PageObservation>;
  inspectElement(id: ElementId): Promise<ElementObservation>;
  findElements(query: ElementQuery): Promise<ElementId[]>;
  getGeometry(id: ElementId): Promise<GeometrySnapshot>;
  getComputedStyles(id: ElementId): Promise<ComputedStyleSnapshot>;
  execute(operation: OTFOperation): Promise<OperationResult>;
  executeBatch(operations: readonly OTFOperation[]): Promise<BatchResult>;
  checkpoint(label?: string): Promise<CheckpointId>;
  rollback(id: CheckpointId): Promise<RollbackResult>;
  getChanges(): Promise<readonly OTFChange[]>;
  getSessionState(): Promise<OTFSessionState>;
}
