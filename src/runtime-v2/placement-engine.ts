export interface IntendedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MovePlacementStrategy = "in-flow" | "detached";

export type PlacementCoordinateSpace = "viewport" | "page";

export interface ExistingPlacementState {
  detached: boolean;
  interactionSafeFixed: boolean;
  transformOnly: boolean;
}

export interface MovePlacementRequest {
  element: HTMLElement;
  currentRect: IntendedRect;
  dx: number;
  dy: number;
  forceIndependent?: boolean;
  existing?: ExistingPlacementState;
}

export interface MovePlacementPlan {
  readonly strategy: MovePlacementStrategy;
  readonly dx: number;
  readonly dy: number;
  readonly intendedRect: IntendedRect;
  readonly expectedRect: IntendedRect;
  readonly coordinateSpace: PlacementCoordinateSpace;
  readonly flowSlotRemains: boolean;
  readonly rollback: "restore-dom-snapshot";
  readonly payload: {
    dx: number;
    dy: number;
    detached?: boolean;
    transformOnly?: boolean;
    interactionSafeFixed?: boolean;
    detachedLeft?: number;
    detachedTop?: number;
    detachedZIndex?: string;
    fixedViewportLeft?: number;
    fixedViewportTop?: number;
    fixedWidth?: number;
    fixedHeight?: number;
    interactionPlacementMode?: "viewport-fixed" | "containing-block-absolute";
    interactionPlacementLeft?: number;
    interactionPlacementTop?: number;
    interactionAnchorCssPath?: string | null;
  };
}

/** Computes a plan. Must not write history, persistence, overlay, or mutate DOM. */
export interface PlacementEngine {
  planMove(request: MovePlacementRequest): MovePlacementPlan;
  isIndependent(element: HTMLElement): boolean;
}
