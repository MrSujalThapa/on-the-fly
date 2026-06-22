import type { VisualNodeId } from "../ids.js";
import type { MatchViewport } from "../dom/types.js";

export interface MeasurementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MeasurementContext {
  viewport: MatchViewport;
  scanRoot: ParentNode;
  nextNodeIndex: number;
}

export interface ScanOptions {
  scanRoot?: ParentNode;
  viewport?: MatchViewport;
  includePageLevel?: boolean;
}

export type AlignmentEdge =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "centerX"
  | "centerY";

export interface VisualNodeBuildResult {
  nodes: Map<VisualNodeId, import("../visual-node.js").VisualNode>;
  rootNodeIds: VisualNodeId[];
}
