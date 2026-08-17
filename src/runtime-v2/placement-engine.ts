export interface IntendedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MovePlacementStrategy =
  | "in-flow"
  | "detached"
  | "interaction-safe-fixed"
  | "transform-only";

export interface MovePlacementRequest {
  dx: number;
  dy: number;
  element: HTMLElement;
  originalRect: IntendedRect;
}

export interface MovePlacementPlan {
  readonly strategy: MovePlacementStrategy;
  readonly dx: number;
  readonly dy: number;
  readonly intendedRect: IntendedRect;
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

/** Computes a plan. Must not write history, persistence, or overlay state. */
export interface PlacementEngine {
  planMove(request: MovePlacementRequest): MovePlacementPlan;
}
