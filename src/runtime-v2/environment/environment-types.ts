import type { CreatedElementAppearance, CreatedElementContent, CreatedElementKind } from "../../editor/create/created-element.js";
import type { VisualNodeId } from "../../editor/ids.js";
import type { LayerCommand } from "../../editor/transform/layer-order.js";
import type { EnvironmentError } from "./environment-errors.js";

/** The existing VisualModel identity, exposed without introducing another ID system. */
export type ElementId = VisualNodeId;
export type ElementOrigin = "host" | "clone" | "created";

export interface GeometrySnapshot {
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
  readonly top: number; readonly left: number; readonly right: number; readonly bottom: number;
  readonly rotation: number; readonly placement: "attached" | "independent";
}

export interface ComputedStyleSnapshot {
  readonly display: string; readonly position: string; readonly visibility: string; readonly opacity: string;
  readonly width: string; readonly height: string; readonly color: string; readonly backgroundColor: string;
  readonly backgroundImage: string; readonly fontFamily: string; readonly fontSize: string; readonly fontWeight: string;
  readonly lineHeight: string; readonly border: string; readonly borderRadius: string; readonly boxShadow: string;
  readonly overflowX: string; readonly overflowY: string; readonly zIndex: string; readonly flexDirection: string;
  readonly alignItems: string; readonly justifyContent: string; readonly gap: string;
  readonly gridTemplateColumns: string; readonly gridTemplateRows: string;
}

export interface ElementSummary {
  readonly id: ElementId; readonly origin: ElementOrigin; readonly tag: string;
  readonly role?: string; readonly text?: string;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly selected: boolean;
}

export interface ElementObservation extends ElementSummary {
  readonly geometry: GeometrySnapshot;
  readonly computedStyle: ComputedStyleSnapshot;
  readonly capabilities: {
    readonly move: boolean; readonly resize: boolean; readonly rotate: boolean; readonly style: boolean;
    readonly editText: boolean; readonly create: boolean; readonly duplicate: boolean; readonly delete: boolean; readonly layer: boolean;
  };
  readonly relationships: { readonly parent?: ElementId; readonly children: readonly ElementId[] };
}

export interface PageObservation {
  readonly sessionId: string; readonly url: string;
  readonly viewport: { readonly width: number; readonly height: number; readonly scrollX: number; readonly scrollY: number };
  readonly selection: readonly ElementId[]; readonly elements: readonly ElementSummary[]; readonly revision: number;
}

export interface ElementQuery {
  readonly text?: string; readonly role?: string; readonly tag?: string; readonly origin?: ElementOrigin; readonly visibleOnly?: boolean;
}

export type OTFOperation =
  | { readonly type: "move"; readonly target: ElementId; readonly delta: { readonly x: number; readonly y: number } }
  | { readonly type: "layer"; readonly target: ElementId; readonly command: LayerCommand }
  | { readonly type: "create"; readonly kind: CreatedElementKind; readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }; readonly appearance?: CreatedElementAppearance; readonly content?: CreatedElementContent; readonly elementId?: string }
  | { readonly type: "resize" | "rotate" | "style" | "text" | "duplicate" | "delete" | "group" | "ungroup"; readonly target?: ElementId; readonly targets?: readonly ElementId[]; readonly [key: string]: unknown };

export interface OperationResult {
  readonly ok: boolean; readonly operationId?: string; readonly target?: ElementId;
  readonly before?: GeometrySnapshot; readonly after?: GeometrySnapshot; readonly revision?: number; readonly error?: EnvironmentError;
}

export interface OTFChange {
  readonly operationId: string; readonly type: string; readonly target?: ElementId;
}

export interface OTFSessionState {
  readonly sessionId: string; readonly url: string; readonly selection: readonly ElementId[];
  readonly revision: number; readonly persistedRevision: number; readonly dirty: boolean;
  readonly canUndo: boolean; readonly canRedo: boolean;
  readonly elementCounts: { readonly host: number; readonly clone: number; readonly created: number };
}

export interface OTFEnvironment {
  observe(options?: { readonly scope?: "viewport" | "selection" }): Promise<PageObservation>;
  inspectElement(id: ElementId): Promise<ElementObservation>;
  findElements(query: ElementQuery): Promise<ElementId[]>;
  getGeometry(id: ElementId): Promise<GeometrySnapshot>;
  getComputedStyles(id: ElementId): Promise<ComputedStyleSnapshot>;
  getSessionState(): Promise<OTFSessionState>;
  getChanges(): Promise<readonly OTFChange[]>;
  execute(operation: OTFOperation): Promise<OperationResult>;
  checkpoint(label?: string): Promise<OperationResult>;
  rollback(id: string): Promise<OperationResult>;
}
